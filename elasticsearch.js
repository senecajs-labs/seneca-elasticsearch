/* jshint indent: 2, asi: true */
// vim: noai:ts=2:sw=2

var pluginName    = 'search'

var _             = require('underscore');
var assert        = require('assert');
var async         = require('async');
var elasticsearch = require('elasticsearch');
var ejs           = require('elastic.js');
var uuid          = require('node-uuid');

function search(options, register) {
  var options = options || {};
  var seneca = this;

  // Apply defaults individually,
  // instead of all-or-nothing.
  var connectionOptions = options.connection || {};


  _.defaults(connectionOptions, {
    host          : '127.0.0.1:9200',
    sniffInterval : 300000,
    index         : 'seneca',
    sniffOnStart  : true,
    log           : 'error'
  });

  var esClient = new elasticsearch.Client(connectionOptions);

  /**
  * Seneca bindings.
  *
  * We compose what needs to happen during the events
  * using async.seq, which nests the calls the functions
  * in order, passing the same context to all of them.
  */

  // startup
  seneca.add({init: pluginName}, ensureIndex);

  // index events
  seneca.add({role: pluginName, cmd: 'create-index'}, ensureIndex);

  seneca.add({role: pluginName, cmd: 'has-index'}, hasIndex);

  seneca.add({role: pluginName, cmd: 'delete-index'},
    async.seq(ensureIndex, deleteIndex));

  // data events
  seneca.add({role: pluginName, cmd: 'save'},
    async.seq(populateRequest, populateBody, saveRecord));

  seneca.add({role: pluginName, cmd: 'load'},
    async.seq(populateRequest, loadRecord));

  seneca.add({role: pluginName, cmd: 'search'},
    async.seq(populateRequest, populateSearch, populateSearchBody, doSearch, fetchEntitiesFromDB));

  seneca.add({role: pluginName, cmd: 'remove'},
    async.seq(populateRequest, removeRecord));

  // entity events
  seneca.add({role:'entity',cmd:'save'},
    async.seq(populateCommand, pickFields, entityPrior, entitySave, entityAct));

  seneca.add({role:'entity',cmd:'remove'},
    async.seq(populateCommand, entityRemove, entityPrior, entityAct));

  register(null, {
    name: pluginName,
    native: esClient
  });

  /*
  * Entity management
  */

  function populateCommand(args, cb) {
    args.entityData = args.ent.data$();
    args.command = {
      role  : pluginName,
      index : connectionOptions.index,
      type  : args.entityData.entity$.name,
    }

    cb(null, args);
  }

  function pickFields(args, cb) {
    var data = args.ent.data$();

    // allow per-entity field configuration
    var _type = args.command.type;
    var _entities = options.entities || {};
    var _fields = _entities[_type] || [];

    // always pass through _id if it exists
    // TODO: reconsider this?
    _fields.push('_id');


    data = _.pick.apply(_, [data, _fields]);

    args.entityData = data;
    cb(null, args);
  }

  function entitySave(args, cb) {
    args.ent.id$ = args.ent.id$ || args.ent._id || args.ent.id || uuid.v4();

    args.command.cmd = 'save';
    args.command.data = args.entityData;
    args.command.id = args.ent.id$;

    cb(null, args);
  }

  function entityRemove(args, cb) {
    args.command.cmd = 'remove';
    args.command.id = args.q.id;
    cb(null, args);
  }

  function entityPrior(args, cb) {
    this.prior(args, function(err, result) {
      args.entityResult = result;
      cb(null, args);
    });
  }

  function entityAct(args, cb) {
    assert(args.command, "missing args.command");

    seneca.act(args.command, function( err, result ) {
      if(err) {
        return seneca.fail(err);
      } else {
        cb(null, args.entityResult);
      }
    });
  }

  /*
  * Index management.
  */
  function hasIndex(args, cb) {
    esClient.indices.exists({index: args.index}, cb);
  }

  function createIndex(args, cb) {
    esClient.indices.create({index: args.index}, cb);
  }

  function deleteIndex(args, cb) {
    esClient.indices.delete({index: args.index}, cb);
  }

  // creates the index for us if it doesn't exist.
  function ensureIndex(args, cb) {
    args.index = args.index || connectionOptions.index;

    assert.ok(args.index, 'missing args.index');

    hasIndex(args, onExists);

    function onExists(err, exists) {
      if (err || !exists) {
        createIndex(args, passArgs(args, cb));
      } else {
        cb(err, args);
      }
    }
  }

  /**
  * Record management.
  */
  function saveRecord(args, cb) {
    // We explicitly don't care about the seneca entity id$
    args.request.id = args.id || args.data._id;
    esClient.index(args.request, cb);
  }

  function loadRecord(args, cb) {
    // You need to be explicit when specifying id
    args.request.id = args.id;
    esClient.get(args.request, cb);
  }

  function removeRecord(args, cb) {
    // You need to be explicit when specifying id
    args.request.id = args.id;
    esClient.delete(args.request, function(err, result) {
      cb(null, result);// swallow the error
    });
  }

  function doSearch(args, cb) {
    esClient.search(args.request, cb);
  }

  function fetchEntitiesFromDB(esResults, statusCode, cb) {
    var ids  = [];
    
    if(esResults && esResults.hits && esResults.hits.hits && esResults.hits.hits.length > 0) {
      var hits = esResults.hits.hits;
      
      var query = { 
        ids: []
      }
      for(var i = 0; i < hits.length; i++) {
        var typeHelper = seneca.make('-/sys/' + hits[i]._type);
        query.ids.push(hits[i]._id);
      }

      typeHelper.list$(query, function(err, objects) {

        if(err) { 
          return cb(err, undefined); 
        }
        var databaseResults = objects;
        if(databaseResults) {
          for(var i = esResults.hits.hits.length-1; i >= 0; i--) {
            var shouldRemove = true;
            for(var j = 0; j < databaseResults.length; j++) {
              if(esResults.hits.hits[i]._id === databaseResults[j].id) {
                shouldRemove = false;
                esResults.hits.hits[i]._source = databaseResults[j];
              }
            }
            if(shouldRemove) {
              esResults.hits.hits.splice(i, 1);
            }
          } 
        }
        esResults.hits.total = databaseResults.length;
        cb(undefined, esResults);
      });
    } else {
      cb(undefined, esResults);
    }
  }

  /**
  * Constructing requests.
  */

  function populateBody(args, cb) {
    args.request.body = args.data;
    cb(null, args);
  }

  function populateSearch(args, cb) {
    var _search = args.search;

    if (!_search) {
      var _query = (args.q && _.isString(args.q) ?
        ejs.QueryStringQuery(args.q) :
        ejs.MatchAllQuery());

      _search = JSON.parse(ejs.Request().query(_query).toString());
    }

    args.searchRequest = _search;

    cb(null, args);
  }

  function populateSearchBody(args, cb) {
    args.request.body = args.searchRequest;
    cb(null, args);
  }

  function populateRequest(args, cb) {
    assert.ok(args.data || args.type, 'missing args.data and args.type');

    var dataType = args.type || args.data.entity$;
    assert.ok(dataType, 'expected either "type" or "data.entity$" to deduce the entity type');

    args.request = {
      index: args.index,
      type: dataType,
      refresh: options.refreshOnSave,
    };

    cb(null, args);
  }

  // ensures callback is called consistently
  function passArgs(args, cb) {
    return function (err, resp) {
      if (err) { return seneca.fail(err); }

      cb(err, args);
    }
  }

}

module.exports = search;

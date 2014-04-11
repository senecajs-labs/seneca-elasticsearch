/* jshint indent: 2, asi: true */
// vim: noai:ts=2:sw=2

var pluginName    = 'search'

var _             = require('underscore');
var assert        = require('assert');
var async         = require('async');
var elasticsearch = require('elasticsearch');
var ejs           = require('elastic.js');

function search(options, register) {
  var options = options || {};
  var seneca = this;

  // Apply defaults individually,
  // instead of all-or-nothing.
  var connectionOptions = options.connection || {};

  // Which fields to let through
  var fieldOptions = options.fields || ['id'];

  _.defaults(connectionOptions, {
    host          : 'localhost:9200',
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
    async.seq(populateRequest, populateSearch, populateSearchBody, doSearch));

  seneca.add({role: pluginName, cmd: 'remove'},
    async.seq(populateRequest, removeRecord));

  // entity events
  seneca.add({role:'entity',cmd:'save'},
    async.seq(populateCommand, entitySave, entityPrior, entityAct));

  seneca.add({role:'entity',cmd:'remove'},
    async.seq(populateCommand, entityRemove, entityPrior, entityAct));

  register(null, {
    name: pluginName,
    native: esClient
  });

  /*
  * Entity management
  */
  function entitySave(args, cb) {
    args.command.cmd = 'save';
    args.command.data = args.ent.data$();

    // TODO: _.pick only the specified keys
    cb(null, args);
  }

  function entityRemove(args, cb) {
    var prior = this.prior.bind(this);

    args.command.cmd = 'remove';
    args.command.data = { id: args.ent.id || args.ent.id$ };
    cb(null, args);
  }

  function entityPrior(args, cb) {
    this.prior(args, passArgs(args, cb));
  }

  function entityAct(args, cb) {
    assert(args.command, "missing args.command");

    args.command.data.id = args.ent.id;

    seneca.act(args.command, function( err ) {
      if(err) { return seneca.fail(err); }
    });
  }

  function pickFields(args, cb) {
    var fields = options.fields || false;

    var data = args.ent.data$();

    if (fields) {
      fields.push('id'); // always have an id field
      data = _.pick.apply(_, [data, fields]);
    }

    cb.entityData = data;
    cb(null, args);
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
    args.request.id = args.data.id;

    if (args.request.id) {
      args.request.method = 'put';
    }

    esClient.index(args.request, cb);
  }

  function loadRecord(args, cb) {
    args.request.id = args.data.id;
    esClient.get(args.request, cb);
  }

  function removeRecord(args, cb) {
    args.request.id = args.data.id;
    esClient.delete(args.request, cb);
  }

  function doSearch(args, cb) {
    esClient.search(args.request, cb);
  }

  /**
  * Constructing requests.
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
      if (err) { console.error(err); }

      cb(err, args);
    }
  }

}

module.exports = search;

/* jshint indent: 2, asi: true */
// vim: noai:ts=2:sw=2

var pluginName      = 'search'

var _               = require('underscore');
var assert          = require('assert');
var async           = require('async');
var ParallelRunner  = require('serial').ParallelRunner;
var elasticsearch   = require('elasticsearch');
var ejs             = require('elastic.js');
var uuid            = require('node-uuid');

function search(options) {
  var options = options || {};
  var seneca = this;

  // Apply defaults individually,
  // instead of all-or-nothing.
  var connectionOptions = options.connection || {};

  var pingTimeout = options.pingTimeout || 1000;
  
  _.defaults(connectionOptions, {
    host          : '127.0.0.1:9200',
    sniffInterval : 300000,
    index         : 'seneca',
    log           : 'error'
  });

  connectionOptions = _.clone(connectionOptions);
  var esClient = new elasticsearch.Client(connectionOptions);

  var indexConfig = options.indexConfig ? options.indexConfig : {};

  var entitiesConfig = {};
  if(options.entities) {
    for(var i = 0 ; i < options.entities.length ; i++) {
      var entitySettings = options.entities[i];
      var esEntityName = entityNameFromObj(entitySettings);
      var config = entitiesConfig[esEntityName] = {};
      if(entitySettings.indexedAttributes) {
        config.indexedAttributes = Object.keys(entitySettings.indexedAttributes);
        config.mapping = entitySettings.indexedAttributes;
      }
    }
  }

  /**
   * Seneca bindings.
   *
   * We compose what needs to happen during the events
   * using async.seq, which nests the calls the functions
   * in order, passing the same context to all of them.
   */

    // startup
  seneca.add({init: pluginName},
    async.seq(pingCluster, ensureIndex, putMappings));

  function pingCluster(args, cb) {
    esClient.ping({
      requestTimeout: pingTimeout,
      // undocumented params are appended to the query string
      hello: "elasticsearch!"
    }, function (error) {
      if (error) {
        cb(error, undefined);
      } else {
        cb(undefined, args);
      }
    });
  }

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

  seneca.add({role: pluginName, cmd: 'count'},
    async.seq(populateRequest, populateSearch, populateSearchBody, doCount, fetchEntitiesFromDB));

  seneca.add({role: pluginName, cmd: 'search'},
    async.seq(populateRequest, populateSearch, populateSearchBody, doSearch, fetchEntitiesFromDB));

  seneca.add({role: pluginName, cmd: 'remove'},
    async.seq(populateRequest, removeRecord));


  // entity events
  if(options.entities && options.entities.length > 0) {
    for(var i = 0 ; i < options.entities.length ; i++) {
      var entityDef = options.entities[i];

      seneca.add(
        augmentArgs({
          role:'entity',
          cmd:'save'
        }, entityDef),
        async.seq(populateCommand, entityPrior, pickFields, entitySave, entityAct));

      seneca.add(
        augmentArgs({
          role:'entity',
          cmd:'remove'
        }, entityDef),
        async.seq(populateCommand, entityRemove, entityPrior, entityAct));
    }
  } else {
    seneca.add({role:'entity',cmd:'save'},
      async.seq(populateCommand, entityPrior, pickFields, entitySave, entityAct));

    seneca.add({role:'entity',cmd:'remove'},
      async.seq(populateCommand, entityRemove, entityPrior, entityAct));
  }

  /*
   * Entity management
   */

  function populateCommand(args, cb) {
    args.entityData = args.ent.data$();
    args.command = {
      role  : pluginName,
      index : connectionOptions.index,
      type  : entityNameFromObj(args.entityData.entity$),
      update: !!args.ent.id
    };

    cb(null, args);
  }

  function pickFields(args, cb) {
    var data = args.entityResult.data$();

    // allow per-entity field configuration
    var type = args.command.type;

    var typeConfig = entitiesConfig[type];
    var indexedAttributes = [];
    if(typeConfig && typeConfig.indexedAttributes) {
      indexedAttributes = typeConfig.indexedAttributes;
    }
    data = _.pick(data, indexedAttributes);
    data.entity$ = args.entityResult.entity$;

    args.entityData = data;
    cb(null, args);
  }

  function entitySave(args, cb) {

    args.command.cmd = 'save';
    args.command.data = args.entityData;
    args.command.id = args.entityData.id;

    cb(null, args);
  }

  function entityRemove(args, cb) {
    args.command.cmd = 'remove';
    args.command.id = args.q.id;
    cb(null, args);
  }

  function entityPrior(args, cb) {
    this.prior(args, function(err, result) {
      if(err) {
        return cb(err, undefined);
      } else {
        args.entityResult = result;
        cb(null, args);
      }
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
    var param = {};

    param.index = args.index;
    
    if(!_.isEmpty(indexConfig)){
      param.body = {settings: indexConfig.settings};
    }

    esClient.indices.create(param, function(err) {
      if(err && /^IndexAlreadyExistsException/m.test(err.message)) {
        cb()
      } else {
        cb(err)
      }
    });
  }

  function deleteIndex(args, cb) {
    esClient.indices.delete({index: args.index}, cb);
  }

  // creates the index for us if it doesn't exist.
  function ensureIndex(args, cb) {
    args.index = args.index || connectionOptions.index;

    assert.ok(args.index, 'missing args.index');

    createIndex(args, passArgs(args, cb));
  }

  function entityNameFromObj(obj) {
    var esName = '';
    if(obj.zone) {
      esName += obj.zone + '_';
    }
    if(obj.base) {
      esName += obj.base + '_';
    }
    esName += obj.name || 'undefined';
    return esName;
  }

  function entityNameFromStr(canonizedName) {
    return canonizedName.replace('-/', '').replace('/', '_');
  }

  function putMappings(args, cb) {
    var r = new ParallelRunner();
    for(var entityType in entitiesConfig) {
      var mapping = {};
      var properties = {};
      var hasProperties = false;
      for(var prop in entitiesConfig[entityType].mapping) {
        if(entitiesConfig[entityType].mapping[prop] !== true) {
          properties[prop] = entitiesConfig[entityType].mapping[prop];
          hasProperties = true;
        }
      }
      properties.entity$ = {
        type: 'string',
        index: 'not_analyzed'
      };
      properties.id = {
        type: 'string',
        index: 'not_analyzed'
      };
      mapping[entityType] = {
        properties: properties
      };
      r.add(putMapping, entityType, mapping);
    }
    r.run(function() {
      cb();
    });
  }

  function putMapping(type, mapping, cb) {
    esClient.indices.putMapping({
      index: connectionOptions.index,
      type: type,
      body: mapping
    }, function(err, response) {
      if(err) throw err
      cb(undefined, response)
    });
  }

  /**
   * Record management.
   */
  function saveRecord(args, cb) {
    var skip = false;

    //if filters are set in options, saveRecord will skip over records which accomplish the filter condition
    if (options.filters && options.filters[args.type]) {
      var filter = options.filters[args.type];
      _.each(filter, function (ex, key) {
        if (!((ex === args.data[key]) || ('' + args.data[key]).match(ex))) {
          skip = true;
        }
      })
    }

    if (skip) {
      setImmediate(cb)
    }
    else {
      // set the ES id as the entity id. We use it for 1-1 mapping between
      // ES and the DB.
      args.request.id = args.data.id;

      if(args.update) {
        args.request.body = {
          doc: args.request.body,
          upsert: args.request.body
        }
        esClient.update(args.request, cb);
      } else {
        esClient.index(args.request, cb);
      }
    }
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

  function doCount(args, cb) {
    esClient.count(args.request, cb);
  }

  function fetchEntitiesFromDB(esResults, statusCode, cb) {
    var seneca = this;
    if(esResults && esResults.hits && esResults.hits.hits && esResults.hits.hits.length > 0) {
      var hits = esResults.hits.hits;

      var query = {
        ids: []
      }

      //must search in database through all types if search return multiple types results
      var resultTypes = {};

      _.each(hits, function(hit){
        var esType = entityNameFromStr(hit._source.entity$);
        if(!resultTypes[esType]){
          resultTypes[esType] = {
            type: hit._source.entity$,
            ids: [],
            hits: []
          };
          resultTypes[esType].ids.push(hit._id);
          resultTypes[esType].hits.push(hit);
        } else {
          resultTypes[esType].ids.push(hit._id);
          resultTypes[esType].hits.push(hit);
        }
      });

      var totalHits = 0;
      async.each(_.keys(resultTypes), function(esType, next) {

        var typeHelper = seneca.make(resultTypes[esType].type);

        query.ids = query.ids.concat(resultTypes[esType].ids);
        var hits = resultTypes[esType].hits;

        typeHelper.list$(query, function(err, objects) {
          if (err) {
            return cb(err, undefined);
          }
          var databaseResults = objects;
          if (databaseResults) {
            // Go from high to low because we're splicing out of the array while we're iterating through it
            for (var i = hits.length - 1; i >= 0; i--) {
              hits[i]._source = _.find(databaseResults, function (item) {
                return hits[i]._id === item.id;
              });
              if (!hits[i]._source) {
                hits.splice(i, 1);
                esResults.hits.total -= 1;
              }
            }

            resultTypes[esType].hits = hits;
          }
          totalHits += esResults.hits.total;
          next();
        });
      }, function(err){
        if(err) {
          if (err) { return seneca.fail(err); }
        } else {
          esResults.hits.hits = [];
          _.each(_.keys(resultTypes), function(esType){
            esResults.hits.hits = esResults.hits.hits.concat(resultTypes[esType].hits);
          });
          esResults.hits.total = totalHits;
          cb(undefined, esResults);
        }
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

    var dataType = args.type || entityNameFromStr(args.data.entity$);
    assert.ok(dataType, 'expected either "type" or "data.entity$" to deduce the entity type');

    args.request = {
      index: args.index || connectionOptions.index,
      type: dataType,
      refresh: options.refreshOnSave
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

  function augmentArgs(args, entityDef) {
    if(entityDef.zone) {
      args.zone = entityDef.zone;
    }
    if(entityDef.base) {
      args.base = entityDef.base;
    }
    if(entityDef.name) {
      args.name = entityDef.name;
    }
    return args;
  }

}

module.exports = search;

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
  var seneca = this;

  options = options || {};

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


  var entitiesConfig = _.reduce(options.entities || [], function(m, entity) {
    var config = {};

    var name = entityNameFromObj(entity);

    if (entity.indexedAttributes) {
      config.indexedAttributes = _.keys(entity.indexedAttributes);
      config.mapping = entity.indexedAttributes;
    }

    m[name] = config;
    return m;
  }, {});


  var customAnalyzers = options.customAnalyzers;

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

  seneca.add({role: pluginName, cmd: 'refresh'},
    async.seq(populateRequest, doRefresh));

  seneca.add({role: pluginName, cmd: 'count'},
    async.seq(populateRequest, populateSearch, populateSearchBody, doCount, fetchEntitiesFromDB));

  seneca.add({role: pluginName, cmd: 'search'},
    async.seq(populateRequest, populateSearch, populateSearchBody, doSearch, fetchEntitiesFromDB));

  seneca.add({role: pluginName, cmd: 'remove'},
    async.seq(populateRequest, removeRecord));


  // entity events
  if(options.entities && options.entities.length > 0) {
    _.each(options.entities || [], function(entity) {
      seneca.add(
        augmentArgs({ role:'entity', cmd:'save' }, entity),
        async.seq(populateCommand, entityPrior, entitySave, entityAct));

      seneca.add(
        augmentArgs({ role:'entity', cmd:'remove' }, entity),
        async.seq(populateCommand, entityRemove, entityPrior, entityAct));
    })
  } else {
    seneca.add({role:'entity',cmd:'save'},
      async.seq(populateCommand, entityPrior, entitySave, entityAct));

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

  function entitySave(args, cb) {
    var result = args.entityResult.data$();

    // allow per-entity field configuration
    var type = args.command.type;

    var typeConfig = entitiesConfig[type];
    var indexedAttributes = [];
    if(typeConfig && typeConfig.indexedAttributes) {
      indexedAttributes = typeConfig.indexedAttributes;
    }
    var data = _.pick(result, indexedAttributes);

    data.id = result.id;

    args.entityData = data;
    args.command.cmd = 'save';
    args.command.data = args.entityData;
    if (args.entityData.id) {
      args.command.id = args.entityData.id;
    }
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
        return cb(seneca.fail(err));
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
    var body = {
      settings: {}
    };
    if (customAnalyzers) {
      _.extend(body.settings, {
        analysis: { analyzer: customAnalyzers }
      });
    }
    esClient.indices.create({
      index: args.index,
      body: body
    }, function(err) {
      // callback with false if the index was not created
      if(err && /^IndexAlreadyExistsException/m.test(err.message)) {
        cb(null, false)
      } else {
        cb(err, !err)
      }
    });
  }

  function deleteIndex(args, cb) {
    esClient.indices.delete({index: args.index}, cb);
  }

  function verifyCustomAnalyzers(args, cb) {
    async.waterfall([
      function(done) {
        // read settings
        esClient.indices.getSettings({index: args.index}, function(err, response) {
          if (err) { return done(err); }
          return done(null, response[args.index] && response[args.index].settings.index);
        });
      },
      function(settings, done) {
        // check all custom analyzers appear in index
        var analyzers = settings.analysis && settings.analysis.analyzer;
        var needsUpdate = false;
        _.each(_.keys(customAnalyzers), function(name) {
          if (!analyzers || !analyzers[name] || !_.isEqual(analyzers[name], customAnalyzers[name])) {
            needsUpdate = true;
          }
        });
        return done(null, needsUpdate);
      }
    ], cb);
  }

  function addCustomAnalyzers(args, cb) {
    // have to close the index before adding analyzers
    esClient.indices.close({index: args.index}, function(err) {
      if (err) { return cb(err); }

      // passing analyzers as configured in module options
      var body = {
        analysis: { analyzer: customAnalyzers }
      };

      // update settings
      esClient.indices.putSettings({
        index: args.index,
        body: body
      }, function(err) {
        esClient.indices.open({index: args.index}, function(errOpen) {
          return cb(errOpen || err);
        });
      });
    });
  }

  // creates the index for us if it doesn't exist.
  function ensureIndex(args, cb) {
    args.index = args.index || connectionOptions.index;

    assert.ok(args.index, 'missing args.index');

    async.waterfall([
      // create the index
      _.partial(createIndex, args),
      // check and update the analyzers if required
      function(result, done) {
        // createIndex does not callback with error when index already exists
        //  instead it will callback with false
        // if the index already exists we need to check if any custom analyzers
        //  have been added and update the index settings if so
        if (result === false && customAnalyzers) {
          async.waterfall([
            _.partial(verifyCustomAnalyzers, args),
            function(needsUpdate, done) {
              if (needsUpdate) {
                addCustomAnalyzers(args, done);
              }
              else {
                return done();
              }
            }
          ], done);
        }
        else {
          return done();
        }
      }
    ], passArgs(args, cb));
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
    var mapping = _.each(entitiesConfig, function(entity, name) {
      var properties = _.reduce(entity.mapping, function(mem, val, key) {
        if (val !== true) {
          mem[key] = val;
        }
        return mem;
      }, {});
      
      properties.entity$ = {
        type: 'string',
        index: 'not_analyzed'
      };
      properties.id = {
        type: 'string',
        index: 'not_analyzed'
      };

      r.add(putMapping, name, { properties: properties });
    });

    r.run(function() { cb() });
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
          // use the content of the doc to upsert if the document is missing in ES
          doc_as_upsert: true
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

  function doRefresh(args, cb) {
    esClient.indices.refresh(options.connection.index, cb);
  }

  function doSearch(args, cb) {
    esClient.search(args.request, cb);
  }

  function doCount(args, cb) {
    esClient.count(args.request, cb);
  }

  // TODO: is this really a general api requirement?
  function fetchEntitiesFromDB(esResults, statusCode, cb) {

    // this only applies if entities have been defined
    var hasEntities = options.entities && options.entities.length > 0;
    if (!options.fetchEntitiesFromDB || !hasEntities) {
      return cb(null, esResults, statusCode);
    }

    var seneca = this;
    if(esResults && esResults.hits && esResults.hits.hits && esResults.hits.hits.length > 0) {
      var hits = esResults.hits.hits;

      //must search in database through all types if search return multiple types results
      var resultTypes = {};

      _.each(hits, function(hit){
        var esType = entityNameFromStr(hit._source.entity$);
        if(!resultTypes[esType]){
          resultTypes[esType] = {
            type: hit._source.entity$,
            ids: []
          };
        }
        resultTypes[esType].ids.push(hit._id);
      });

      var databaseResults = [];
      async.each(_.keys(resultTypes), function(esType, next) {

        var typeHelper = seneca.make(resultTypes[esType].type);
        typeHelper.list$({ ids: resultTypes[esType].ids }, function(err, objects) {
          if (err) {
            return cb(err, undefined);
          }
          if (objects && objects.length > 0) {
            databaseResults.push.apply(databaseResults, objects);
          }

          next();
        });
      }, function(err){
        if (err) {
          return cb(seneca.fail(err));
        }

        var databaseHits = [];

        databaseResults = _.indexBy(databaseResults, 'id');
        for(var i = 0 ; i < hits.length ; i++) {
          var hit = hits[i];
          hit._source = databaseResults[hit._id];
          if (hit._source) {
            databaseHits.push(hit);
          }
        }

        esResults.hits.hits = databaseHits;

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
      if (err) { return cb(seneca.fail(err)); }
      cb(null, args);
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

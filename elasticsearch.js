/* jshint indent: 2, asi: true */
// vim: noai:ts=2:sw=2

var pluginName    = 'search'

var _             = require('underscore');
var assert        = require('assert');
var async         = require('async');
var elasticsearch = require('elasticsearch');

function search(options, register) {
  var options = options || {};
  var seneca = this;

  // Apply defaults individually,
  // instead of all-or-nothing.
  var connectionOptions = options.connection || {};

  _.defaults(connectionOptions, {
    host          : 'localhost:9200',
    sniffInterval : 300000,
    sniffOnStart  : true,
    log           : 'error'
  });

  var esClient = new elasticsearch.Client(connectionOptions);

  seneca.add({role: pluginName, cmd: 'create-index'}, ensureIndex);
  seneca.add({role: pluginName, cmd: 'has-index'}, hasIndex);
  seneca.add({role: pluginName, cmd: 'delete-index'},
    async.seq(ensureIndex, deleteIndex));

  seneca.add({role: pluginName, cmd: 'save'},
    async.seq(ensureIndex, populateRequest, populateBody, saveRecord));

  seneca.add({role: pluginName, cmd: 'load'},
    async.seq(ensureIndex, populateRequest, loadRecord));

  seneca.add({role: pluginName, cmd: 'remove'},
    async.seq(ensureIndex, populateRequest, removeRecord));

  seneca.add({role:'entity',cmd:'save'}, function(args, cb) {
    console.log('reached it');
    cb('error');
  });

  register(null, {
    name: pluginName,
    native: esClient
  });

  function prior(args, done) {
    var priorFn = this.prior;
    var ent = args.ent;

    var _args = { data: ent };
    _.defaults(_args, args);

    prior(_args, done);
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
    hasIndex(args, onExists)

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
    esClient.index(args.request, cb);
  }

  function loadRecord(args, cb) {
    esClient.get(args.request, cb);
  }

  function removeRecord(args, cb) {
    esClient.delete(args.request, cb);
  }

  /**
  * Constructing requests.
  */
  function populateBody(args, cb) {
    args.request.body = args.data;
    cb(null, args);
  }

  function populateRequest(args, cb) {
    assert.ok(args.data, 'missing args.data');

    var dataType = args.type || args.data.entity$;
    assert.ok(dataType, 'expected either "type" or "data.entity$" to deduce the entity type');

    args.request = {
      index: args.index,
      type: dataType,
      id: args.data.id,
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

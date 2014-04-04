/* jshint indent: 2, asi: true */
// vim: noai:ts=2:sw=2

var pluginName    = 'search'

var _             = require('underscore');
var assert        = require('assert')
var elasticsearch = require('elasticsearch')

function search(options) {
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

  seneca.add({role: pluginName, cmd: 'save'}, function(args, callback) {

    assert.ok(args.data, 'missing args.data')
    var dataType = args.type || args.data.entity$
    assert.ok(dataType, 'expected either "type" or "data.entity$" to deduce the entity type')

    esClient.index({
      index: args.index,
      type: dataType,
      id: args.data.id,
      refresh: options.refreshOnSave,
      body: args.data
    }, function (err, resp) {
      if(err) {
        console.error(err)
      }
      callback(err)
    })

  })

  seneca.add({role: pluginName, cmd: 'delete'}, function(args, callback) {
    callback(undefined)
  })

  return {
    name: pluginName,
    native: esClient
  };


  // creates the index for us if it doesn't exist.
  function ensureIndex(args, done) {
    var indexName = args.index;
    var indices = esClient.indices;

    checkIndexFn(indexName)
       .then(done.bind(null, null))
       .catch(done);

    function checkIndexFn(indexName) {
      return indices.exists({index: indexName}).then(onExists);

      function onExists(err, exists) {
        if (err || !exists) {
          return indices.create({index: indexName});
        }
      }
    }
  }
}

module.exports = search

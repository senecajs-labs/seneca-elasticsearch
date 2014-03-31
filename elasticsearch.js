
var pluginName = 'search'

var assert        = require('assert')
var elasticsearch = require('elasticsearch')

function search(options) {

  var seneca = this

  options = options || {}

  var connectionOptions = options.connection || {
    host: 'localhost:9200',
    sniffOnStart: true,
    sniffInterval: 300000,
    log: 'error'
  }

  var esClient = new elasticsearch.Client(connectionOptions)

  var indexes = {}

  seneca.add({role: pluginName, cmd: 'create-index'}, function(args, callback) {
    var indexName = args.index

    var fields = []

    if(args.fields) {
      for(var i = 0 ; i < args.fields.length ; i++) {
        var field = args.fields[i]
        var suffix = ''
        if(Number(field.priority) !== NaN && field.priority > 1) {
          suffix = '^'+field.priority
        }

        fields.push(field.name + suffix)
      }
    }

    indexes[indexName] = {
      fields: fields.length > 0 ? fields : ['id^3', 'name^2', '*']
    }
    callback(undefined)
  })

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

  seneca.add({role: pluginName, cmd: 'search'}, function(args, callback) {

    var indexName = args.index
    var fields = indexes[indexName] ? indexes[indexName].fields : ['*']

    var searchParams = {
      index: indexName,
      body: {
        query: {
          multi_match : {
            query        : args.query,
            type         : 'best_fields',
            fields       : fields,
            tie_breaker  : 0.3
          }
        }
      }
    }

    if(args.type) {
      search.type = args.type
    }

    esClient.search(searchParams).then(function (resp) {
      callback(undefined, resp.hits.hits)
    }, function (err) {
      callback(err, undefined)
    });
  })

  return {
    name: pluginName,
    native: esClient
  }
}

module.exports = search

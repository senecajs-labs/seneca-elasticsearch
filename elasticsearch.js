
var pluginName = 'search'

var elasticsearch = require('elasticsearch')


function search(options) {

  var seneca = this

  options = options || {
    host: 'elasticsearch1:9200',
    sniffOnStart: true,
    sniffInterval: 300000,
    log: 'trace'
  }

  var esClient = new elasticsearch.Client(options)

  var indexes = {}

  seneca.add(role: pluginName, cmd: 'create-index', function(args, callback) {
    var indexName = args.name

    var fields = []

    if(args.fields) {
      for(var i = 0 ; i < args.fields.length ; i++) {
        var field = args.fields[i]
      }
    }

    indexes[indexName] = {
      fields: fields.length > 0 ? fields : ['id^3', 'name^2', '*']
    }
    callback(undefined)
  })

  seneca.add(role: pluginName, cmd: 'save', function(args, callback) {

    var dataType = args.type || args.data.entity$

    esClient.index({
      index: args.index,
      type: dataType,
      id: 1,
      body:
      }
    }, function (err, resp) {
      callback(err)
    });

  })

  seneca.add(role: pluginName, cmd: 'delete', function(args, callback) {
    callback(undefined)
  })

  seneca.add(role: pluginName, cmd: 'search', function(args, callback) {

    var fields = indexes[indexName] ? indexes[indexName].fields : ['*']

    esClient.search({
      index: args.index,
      type: args.type,
      body: {
        query:
          multi_match : {
            query        : args.query,
            type         : 'best_fields',
            fields       : fields,
            tie_breaker  : 0.3
          }
      }
    }).then(function (resp) {
        callback(undefined, resp.hits.hits)
    }, function (err) {
        callback(err, undefined)
    });
  })

  return {
    name: pluginName
  }
}

module.exports = search

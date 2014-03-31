var assert         = require('assert')
var elasticsearch  = require('elasticsearch')
var esPlugin       = require('../elasticsearch.js')

var seneca = require('seneca')()

seneca.use(esPlugin, {refreshOnSave: true})

describe('elasticsearch', function() {

  var indexName = 'idx1'
  var esClient = new elasticsearch.Client()

  after(function(done) {

    esClient.indices.delete({index: indexName}, function(err) {
      done(err)
    })
  })

  it('create index', function(done) {
    seneca.act({
      role: 'search',
      cmd: 'create-index',
      index: indexName,
      fields: [
        {name: 'id', priority: 3},
        {name: 'name'}
      ]},
      function(err) {
        if(err) throw err
        done()
      }
    )
  })

  it('save entities', function(done) {

    seneca.act({
      role: 'search',
      cmd: 'save',
      index: indexName,
      type: 'type1',
      data: {
        id: 'abcd',
        name: 'caramel'
      }},
      function(err) {
        assert.ok(!err)

        seneca.act({
          role: 'search',
          cmd: 'save',
          index: indexName,
          type: 'type1',
          data: {
            id: 'caramel',
            name: 'abcd'
          }
        },
        function(err) {
          assert.ok(!err)
          done()
        })
      }
    )

  })

  it('search default priority', function(done) {
    seneca.act({
        role: 'search',
        cmd: 'search',
        index: indexName,
        query: 'abcd'
      },
      function(err, results) {
        if(err) { return done(err) }

        assert.ok(results, 'missing results')
        assert.equal(results.length, 2)

        var r0 = results[0]._source
        assert.ok(r0)
        assert.ok(r0.id, 'abcd')
        assert.ok(r0.name, 'caramel')

        var r1 = results[1]._source
        assert.ok(r1)
        assert.ok(r1.id, 'caramel')
        assert.ok(r1.name, 'abcd')

        done()
      }
    )
  })


})

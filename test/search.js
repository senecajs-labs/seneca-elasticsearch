/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var should         = require('should');
var elasticsearch  = require('elasticsearch');
var bulkFixture    = require('./fixtures/bulk.json');
var _              = require('underscore');
var ejs            = require('elastic.js');

var seneca = require('seneca')({ strict: { add: false }});


var indexName = 'seneca-test-search';

seneca.use('..', {
  refreshOnSave: true,
  connection: { index: indexName }
});

before(seneca.ready.bind(seneca));
describe('search', function() {
  var esClient = new elasticsearch.Client();
  var pin = seneca.pin({role: 'search', cmd: '*'});

  before(function(done) {
    esClient.bulk({body: bulkFixture, refresh: true}, throwOnError(done));
  });

  it('can match all results', function(done) {
    var command = { index: indexName, type: 'foobar', data: {} };

    pin.search(command, searchCb);

    function searchCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.hits);
      resp.hits.total.should.eql(7)
      done();
    }

  });

  it('can match a string', function(done) {
    var command = { index: indexName, type: 'foobar', data: {} };
    command.q = "harveysanders@vicon.com";

    pin.search(command, searchCb);

    function searchCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.hits);
      resp.hits.total.should.eql(1)
      done();
    }

  });

  it('can pass a complex query', function(done) {
    var command = { index: indexName, type: 'foobar', data: {} };

    // Use elastic.js to show all men over 30
    // see: http://www.fullscale.co/elasticjs/

    var bq = ejs.BoolQuery()
      .must(ejs.RangeQuery('age').gt(30))
      .must(ejs.MatchQuery('gender', 'male'));

    var _search = ejs.Request().query(bq);

    //TODO: this shouldn't be necessary, but for some reason it is.
    command.search = JSON.parse(_search.toString());

    pin.search(command, searchCb);

    function searchCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.hits);
      resp.hits.total.should.eql(2)
      done();
    }

  });


  after(function(done) {
    esClient.indices.delete({index: indexName}, throwOnError(done));
  });
});

function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}


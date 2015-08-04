![build status](https://travis-ci.org/AdrianRossouw/seneca-elasticsearch.svg)

elastic search plugin to seneca

This plugin will automatically index any entities that are being saved.
Only entities will have their fields filtered by options.fields, the
rest of the api assumes you know what you are doing.

## Setup

```JavaScript

var seneca = require('seneca')({
  strict: { // needed for seneca 0.6.4+
    add: false
  }
});

// important to use a store definition BEFORE including this module
// to automatically index entities
seneca.use('mem-store',{ map:{ '-/-/foo':'*' }});

seneca.use('seneca-elasticsearch', {
  fetchEntitiesFromDB: true, // only enable if you depend on this for permissions.
  refreshOnSave: true, // never enable this if your code needs to run in production.
  entities: [{
	name: 'foo',
	indexedAttributes: { // define mapping to be imported
	  someField: {
		type: 'string',
		index: 'not_analyzed'
	  }
	}
  }],

  connection: { index : indexName }, // customize index name
  pingTimeout: 1000
});

seneca.ready(function(err) {
    if (err) { return console.log(err); }

    // your code here.
    // It will have created the index for you automatically.

});
```


## index management api

```JavaScript
// check for index
seneca.act({role: 'search', cmd: 'create-index', index: 'myIndex'}, callback);

// create an index (checks first)
seneca.act({role: 'search', cmd: 'create-index', index: 'myIndex'}, callback);

// delete an index (checks first)
seneca.act({role: 'search', cmd: 'delete-index', index: 'myIndex'}, callback);
```

## record management api

```JavaScript
// index or update a record
seneca.act({
    role: 'search',
    cmd: 'save',
    index: 'myIndex',
    type: 'myType',
    id: 'myId', // requires either this id
    data: {
        _id: 'myId', // or this id
        /*  rest of object here */
    }
}, callback);

// remove a record
seneca.act({
    role: 'search',
    cmd: 'remove',
    index: 'myIndex',
    type: 'myType',
    id: 'myId'
}, callback);


// load a record
seneca.act({
    role: 'search',
    cmd: 'load',
    index: 'myIndex',
    type: 'myType',
    id: 'myId'
}, callback);
```

## search api

```JavaScript
// return all records
seneca.act({
    role: 'search',
    cmd: 'search',
    index: 'myIndex',
    type: 'myType'
}, callback);

// match lucene query string
seneca.act({
    role: 'search',
    cmd: 'search',
    index: 'myIndex',
    type: 'myType',
    search: "query string here",
    
}, callback);


// match elasticsearch JSON query

// TODO: 
// See tests/search.js for more about this.
// This is most likely what you will want
// to be using.
```

## testing

By default this library maintains a connection to ElasticSearch using a keepAlive.  If you use this library as part of your own plugin,  depending on the testing library you employ it's possible that your tests never complete because the connection is held open.  To disable the keepAlive, do: 

````js
connection:  {
  keepAlive: false,  // NEEDED FOR TESTS ONLY
  sniffInterval: 0   // NEEDED FOR TESTS ONLY
}
````



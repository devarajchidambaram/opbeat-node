'use strict'

process.env.OPBEAT_TEST = true

var agent = require('../../../..').start({
  appName: 'test',
  secretToken: 'test',
  captureExceptions: false
})

var test = require('tape')
var semver = require('semver')
var exec = require('child_process').exec
var Knex = require('knex')
var pkg = require('knex/package')

var transNo = 0
var knex

var selectTests = [
  'knex.select().from(\'test\')',
  'knex.select(\'c1\', \'c2\').from(\'test\')',
  'knex.column(\'c1\', \'c2\').select().from(\'test\')',
  'knex(\'test\').select()'
]

if (semver.gte(pkg.version, '0.11.0')) {
  selectTests.push('knex.select().from(\'test\').timeout(10000)')
}

var insertTests = [
  'knex(\'test\').insert({c1: \'test1\', c2: \'test2\'})'
]

selectTests.forEach(function (source) {
  test(source, function (t) {
    resetAgent(function (endpoint, headers, data, cb) {
      assertBasicQuery(t, data)
      t.end()
    })
    createClient(function userLandCode () {
      agent.startTransaction('foo' + ++transNo)

      var query = eval(source) // eslint-disable-line no-eval

      query.then(function (rows) {
        t.equal(rows.length, 5)
        rows.forEach(function (row, i) {
          t.equal(row.c1, 'foo' + (i + 1))
          t.equal(row.c2, 'bar' + (i + 1))
        })
        agent.endTransaction()
        agent._instrumentation._queue._flush()
      }).catch(function (err) {
        t.error(err)
      })
    })
  })
})

insertTests.forEach(function (source) {
  test(source, function (t) {
    resetAgent(function (endpoint, headers, data, cb) {
      assertBasicQuery(t, data)
      t.end()
    })
    createClient(function userLandCode () {
      agent.startTransaction('foo' + ++transNo)

      var query = eval(source) // eslint-disable-line no-eval

      query.then(function (result) {
        t.equal(result.command, 'INSERT')
        t.equal(result.rowCount, 1)
        agent.endTransaction()
        agent._instrumentation._queue._flush()
      }).catch(function (err) {
        t.error(err)
      })
    })
  })
})

test('knex.raw', function (t) {
  resetAgent(function (endpoint, headers, data, cb) {
    assertBasicQuery(t, data)
    t.end()
  })
  createClient(function userLandCode () {
    agent.startTransaction('foo' + ++transNo)

    var query = knex.raw('SELECT * FROM "test"')

    query.then(function (result) {
      var rows = result.rows
      t.equal(rows.length, 5)
      rows.forEach(function (row, i) {
        t.equal(row.c1, 'foo' + (i + 1))
        t.equal(row.c2, 'bar' + (i + 1))
      })
      agent.endTransaction()
      agent._instrumentation._queue._flush()
    }).catch(function (err) {
      t.error(err)
    })
  })
})

function assertBasicQuery (t, data) {
  t.equal(data.transactions.length, 1)

  var trans = data.transactions[0]

  t.equal(trans.name, 'foo' + transNo)

  // remove the 'select versions();' query that knex injects - just makes
  // testing too hard
  trans.traces = trans.traces.filter(function (trace) {
    return trace.context.extra.sql !== 'select version();'
  })

  t.equal(trans.traces.length, 1)
  t.equal(trans.traces[0].type, 'db.postgresql.query')
  t.ok(trans.traces[0].stacktrace.some(function (frame) {
    return frame.function === 'userLandCode'
  }), 'include user-land code frame')
}

function createClient (cb) {
  setup(function () {
    knex = Knex({
      client: 'pg',
      connection: 'postgres://localhost/test_opbeat'
    })
    cb()
  })
}

function setup (cb) {
  // just in case it didn't happen at the end of the previous test
  teardown(function () {
    exec('psql -d postgres -f pg_reset.sql', { cwd: __dirname }, function (err) {
      if (err) throw err
      exec('psql -d test_opbeat -f pg_data.sql', { cwd: __dirname }, function (err) {
        if (err) throw err
        cb()
      })
    })
  })
}

function teardown (cb) {
  if (knex) {
    knex.destroy(function (err) {
      if (err) throw err
      knex = undefined
      cb()
    })
  } else {
    process.nextTick(cb)
  }
}

function resetAgent (cb) {
  agent._httpClient = { request: function () {
    var self = this
    var args = arguments
    teardown(function () {
      cb.apply(self, args)
    })
  } }
  agent._instrumentation._queue._clear()
  agent._instrumentation.currentTransaction = null
}

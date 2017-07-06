'use strict'

var test = require('tape')
var mockAgent = require('./_agent')
var Transaction = require('../../lib/instrumentation/transaction')
var Trace = require('../../lib/instrumentation/trace')
var protocol = require('../../lib/instrumentation/protocol')

test('protocol.encode - empty', function (t) {
  protocol.encode([], function (err, result) {
    t.error(err)
    t.equal(result, undefined)
    t.end()
  })
})

test('protocol.encode - single transaction', function (t) {
  var agent = mockAgent()

  var t0 = new Transaction(agent, 'single-name0', 'type0')
  t0.result = 'result0'
  t0.setUserContext({foo: 1})
  t0.setExtraContext({bar: 1})
  t0.end()

  protocol.encode([t0], function (err, data) {
    t.error(err)
    t.equal(data.app_name, 'app-name')
    t.equal(data.transactions.length, 1, 'should have 1 transaction')

    data.transactions.forEach(function (trans, index) {
      t.ok(/[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}/.test(trans.id))
      t.equal(trans.name, 'single-name' + index)
      t.equal(trans.type, 'type' + index)
      t.equal(trans.result, 'result' + index)
      t.equal(trans.timestamp, new Date(t0._timer.start).toISOString())
      t.ok(trans.duration > 0, 'should have a duration >0ms')
      t.ok(trans.duration < 100, 'should have a duration <100ms')
      t.deepEqual(trans.context, {
        request: null,
        system: {runtime_version: process.version},
        user: {foo: 1},
        extra: {bar: 1}
      })
      t.equal(trans.traces.length, 0)
    })

    t.end()
  })
})

test('protocol.encode - multiple transactions', function (t) {
  var agent = mockAgent()
  var samples = []

  generateTransaction(0, function () {
    generateTransaction(1, encode)
  })

  function generateTransaction (id, cb) {
    var trans = new Transaction(agent, 'name' + id, 'type' + id)
    trans.result = 'result' + id
    var trace = new Trace(trans)
    trace.start('t' + id + '0', 'type')

    process.nextTick(function () {
      trace.end()
      trace = new Trace(trans)
      trace.start('t' + id + '1', 'type')
      process.nextTick(function () {
        trace.end()
        trans.end()

        samples.push(trans)

        cb()
      })
    })
  }

  function encode () {
    protocol.encode(samples, function (err, data) {
      t.error(err)
      t.equal(data.app_name, 'app-name')
      t.equal(data.transactions.length, 2, 'should have 2 transactions')

      data.transactions.forEach(function (trans, index) {
        t.equal(trans.name, 'name' + index)
        t.equal(trans.type, 'type' + index)
        t.equal(trans.result, 'result' + index)
        t.notOk(Number.isNaN((new Date(trans.timestamp)).getTime()))
        t.ok(trans.duration > 0, 'should have a duration >0ms')
        t.ok(trans.duration < 100, 'should have a duration <100ms')
        t.deepEqual(trans.context, {
          request: null,
          system: {runtime_version: process.version},
          user: {},
          extra: {}
        })

        t.equal(trans.traces.length, 2)

        trans.traces.forEach(function (trace, index2) {
          t.equal(trace.name, 't' + index + index2)
          t.equal(trace.type, 'type')
          t.ok(trace.start > 0, 'trace start should be >0ms')
          t.ok(trace.start < 100, 'trace start should be <100ms')
          t.ok(trace.duration > 0, 'trace duration should be >0ms')
          t.ok(trace.duration < 100, 'trace duration should be <100ms')
          t.ok(trace.stacktrace.length > 0, 'should have stack trace')

          trace.stacktrace.forEach(function (frame) {
            t.equal(typeof frame.filename, 'string')
            t.ok(Number.isFinite(frame.lineno))
            t.equal(typeof frame.function, 'string')
            t.equal(typeof frame.in_app, 'boolean')
            t.equal(typeof frame.abs_path, 'string')
          })
        })
      })

      t.end()
    })
  }
})

test('protocol.encode - http request meta data', function (t) {
  var agent = mockAgent()

  var t0 = new Transaction(agent, 'http-name0', 'type0')
  t0.result = 'result0'
  t0.req = {
    method: 'POST',
    url: '/foo?bar=baz',
    headers: {
      'host': 'example.com',
      'user-agent': 'user-agent-header',
      'content-length': 42,
      'cookie': 'cookie1=foo;cookie2=bar',
      'x-foo': 'bar',
      'x-bar': 'baz'
    },
    socket: {
      encrypted: true,
      remoteAddress: '127.0.0.1'
    },
    body: {
      foo: 42
    }
  }
  t0.end()

  protocol.encode([t0], function (err, data) {
    t.error(err)
    t.equal(data.app_name, 'app-name')
    t.equal(data.transactions.length, 1, 'should have 1 transaction')

    data.transactions.forEach(function (trans, index) {
      t.equal(trans.name, 'http-name' + index)
      t.equal(trans.type, 'type' + index)
      t.equal(trans.result, 'result' + index)
      t.equal(trans.timestamp, new Date(t0._timer.start).toISOString())
      t.ok(trans.duration > 0, 'should have a duration >0ms')
      t.ok(trans.duration < 100, 'should have a duration <100ms')
      t.deepEqual(trans.context, {
        request: { cookies: { cookie1: 'foo', cookie2: 'bar' }, data: '[REDACTED]', headers: { host: 'example.com', 'user-agent': 'user-agent-header', 'content-length': 42, 'x-bar': 'baz', 'x-foo': 'bar' }, method: 'POST', query_string: 'bar=baz', remote_host: '127.0.0.1', secure: true, url: 'https://example.com/foo?bar=baz', user_agent: 'user-agent-header' },
        system: { runtime_version: process.version },
        user: {},
        extra: {}
      })
      t.equal(trans.traces.length, 0)
    })

    t.end()
  })
})

test('protocol.encode - disable stack traces', function (t) {
  var agent = mockAgent()
  agent.captureTraceStackTraces = false

  var t0 = new Transaction(agent, 'single-name0', 'type0')
  t0.result = 'result0'
  var trace0 = t0.buildTrace()
  trace0.start('t00', 'type')
  trace0.end()
  t0.end()

  protocol.encode([t0], function (err, data) {
    t.error(err)
    t.equal(data.app_name, 'app-name')
    t.equal(data.transactions.length, 1, 'should have 1 transaction')

    data.transactions.forEach(function (trans, index) {
      t.equal(trans.name, 'single-name' + index)
      t.equal(trans.type, 'type' + index)
      t.equal(trans.result, 'result' + index)
      t.equal(trans.timestamp, new Date(t0._timer.start).toISOString())
      t.ok(trans.duration > 0, 'should have a duration >0ms')
      t.ok(trans.duration < 100, 'should have a duration <100ms')
      t.deepEqual(trans.context, {
        request: null,
        system: {runtime_version: process.version},
        user: {},
        extra: {}
      })

      t.equal(trans.traces.length, 1)

      trans.traces.forEach(function (trace, index2) {
        t.equal(trace.name, 't' + index + index2)
        t.equal(trace.type, 'type')
        t.ok(trace.start > 0, 'trace start should be >0ms')
        t.ok(trace.start < 100, 'trace start should be <100ms')
        t.ok(trace.duration > 0, 'trace duration should be >0ms')
        t.ok(trace.duration < 100, 'trace duration should be <100ms')
        t.equal(trace.stacktrace, null, 'should not have stack trace')
      })
    })

    t.end()
  })
})

// { transactions:
//    [ { transaction: 'single-name0',
//        result: 'result0',
//        kind: 'type0',
//        timestamp: '2016-12-23T14:36:00.000Z',
//        durations: [ 0.717205 ] } ],
//   traces:
//    { groups:
//       [ { transaction: 'single-name0',
//           signature: 'sig0',
//           kind: 'type0',
//           timestamp: '2016-12-23T14:36:00.000Z',
//           parents: [ 'transaction' ],
//           extra: {} },
//         { transaction: 'single-name0',
//           signature: 'sig1',
//           kind: 'type1.truncated',
//           timestamp: '2016-12-23T14:36:00.000Z',
//           parents: [ 'transaction' ],
//           extra: {} },
//         { transaction: 'single-name0',
//           signature: 'transaction',
//           kind: 'transaction',
//           timestamp: '2016-12-23T14:36:00.000Z',
//           parents: [],
//           extra: {} } ],
//      raw:
//       [
//         [
//           0.717205,
//           [ 0, 0.25884, 0.103199 ],
//           [ 1, 0.284222, 0.345159 ],
//           [ 2, 0, 0.717205 ],
//           { extra: { node: 'v6.9.1', id: 'e5be120b-a85b-468e-a9f9-5b88e1795dbc' } }
//         ]
//       ] } }
test('protocol.encode - truncated traces', function (t) {
  var agent = mockAgent()
  agent.captureTraceStackTraces = false

  var t0 = new Transaction(agent, 'single-name0', 'type0')
  t0.result = 'result0'
  var trace0 = t0.buildTrace()
  trace0.start('t00', 'type0')
  var trace1 = t0.buildTrace()
  trace1.start('t01', 'type1')
  t0.buildTrace()
  trace0.end()
  t0.end()

  protocol.encode([t0], function (err, data) {
    t.error(err)
    t.equal(data.app_name, 'app-name')
    t.equal(data.transactions.length, 1, 'should have 1 transaction')

    data.transactions.forEach(function (trans, index) {
      t.equal(trans.name, 'single-name' + index)
      t.equal(trans.type, 'type' + index)
      t.equal(trans.result, 'result' + index)
      t.equal(trans.timestamp, new Date(t0._timer.start).toISOString())
      t.ok(trans.duration > 0, 'should have a duration >0ms')
      t.ok(trans.duration < 100, 'should have a duration <100ms')
      t.deepEqual(trans.context, {
        request: null,
        system: {runtime_version: process.version},
        user: {},
        extra: {}
      })

      t.equal(trans.traces.length, 2)

      trans.traces.forEach(function (trace, index2) {
        t.equal(trace.name, 't' + index + index2)
        t.equal(trace.type, 'type' + index2 + (index2 === 1 ? '.truncated' : ''))
        t.ok(trace.start > 0, 'trace start should be >0ms')
        t.ok(trace.start < 100, 'trace start should be <100ms')
        t.ok(trace.duration > 0, 'trace duration should be >0ms')
        t.ok(trace.duration < 100, 'trace duration should be <100ms')
        t.equal(trace.stacktrace, null, 'should not have stack trace')
      })
    })

    t.end()
  })
})

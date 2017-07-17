'use strict'

var agent = require('../../../..').start({
  appName: 'test',
  organizationId: 'test',
  secretToken: 'test',
  captureExceptions: false
})

var semver = require('semver')
var version = require('koa-router/package').version
var koaVersion = require('koa/package').version

if (semver.gte(koaVersion, '2.0.0') && semver.lt(process.version, '6.0.0')) process.exit()

var test = require('tape')
var http = require('http')
var Koa = require('koa')
var Router = require('koa-router')

test('route naming', function (t) {
  t.plan(19)

  resetAgent(function (endpoint, headers, data, cb) {
    assert(t, data)
    server.close()
  })

  var server = startServer(function (port) {
    http.get('http://localhost:' + port + '/hello', function (res) {
      t.equal(res.statusCode, 200)
      res.on('data', function (chunk) {
        t.equal(chunk.toString(), 'hello world')
      })
      res.on('end', function () {
        agent._instrumentation._queue._flush()
      })
    })
  })
})

test('route naming with params', function (t) {
  t.plan(19)

  resetAgent(function (endpoint, headers, data, cb) {
    assert(t, data, {name: 'GET /hello/:name'})
    server.close()
  })

  var server = startServer(function (port) {
    http.get('http://localhost:' + port + '/hello/opbeat', function (res) {
      t.equal(res.statusCode, 200)
      res.on('data', function (chunk) {
        t.equal(chunk.toString(), 'hello opbeat')
      })
      res.on('end', function () {
        agent._instrumentation._queue._flush()
      })
    })
  })
})

function startServer (cb) {
  var server = buildServer()
  server.listen(function () {
    cb(server.address().port)
  })
  return server
}

function buildServer () {
  var app = new Koa()
  var router = new Router()

  if (semver.lt(version, '6.0.0')) {
    require('./_generators')(router)
  } else if (semver.gte(version, '6.0.0')) {
    require('./_non-generators')(router)
  }

  app
    .use(router.routes())
    .use(router.allowedMethods())

  return http.createServer(app.callback())
}

function assert (t, data, results) {
  if (!results) results = {}
  results.status = results.status || 200
  results.name = results.name || 'GET /hello'

  t.equal(data.transactions.length, 1)
  t.equal(data.transactions[0].kind, 'request')
  t.equal(data.transactions[0].result, results.status)
  t.equal(data.transactions[0].transaction, results.name)

  t.equal(data.traces.groups.length, 1)
  t.equal(data.traces.groups[0].kind, 'transaction')
  t.deepEqual(data.traces.groups[0].parents, [])
  t.equal(data.traces.groups[0].signature, 'transaction')
  t.equal(data.traces.groups[0].transaction, results.name)

  t.equal(data.traces.raw.length, 1)
  t.equal(data.traces.raw[0].length, 3)
  t.equal(data.traces.raw[0][1].length, 3)
  t.equal(data.traces.raw[0][1][0], 0)
  t.equal(data.traces.raw[0][1][1], 0)
  t.equal(data.traces.raw[0][1][2], data.traces.raw[0][0])
  t.equal(data.traces.raw[0][2].http.method, 'GET')
  t.deepEqual(data.transactions[0].durations, [data.traces.raw[0][0]])
}

function resetAgent (cb) {
  agent._instrumentation.currentTransaction = null
  agent._instrumentation._queue._clear()
  agent._httpClient = { request: cb || function () {} }
  agent.captureError = function (err) { throw err }
}

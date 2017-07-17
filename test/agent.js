'use strict'

var os = require('os')
var zlib = require('zlib')
var util = require('util')
var http = require('http')
var test = require('tape')
var nock = require('nock')
var isRegExp = require('core-util-is').isRegExp
var isError = require('core-util-is').isError
var helpers = require('./_helpers')
var request = require('../lib/request')
var Agent = require('../lib/agent')

var opts = {
  organizationId: 'some-org-id',
  appName: 'some-app-name',
  secretToken: 'secret',
  captureExceptions: false
}

var optionFixtures = [
  ['appName', 'APP_NAME'],
  ['organizationId', 'ORGANIZATION_ID'],
  ['secretToken', 'SECRET_TOKEN'],
  ['logLevel', 'LOG_LEVEL', 'info'],
  ['hostname', 'HOSTNAME', os.hostname()],
  ['stackTraceLimit', 'STACK_TRACE_LIMIT', Infinity],
  ['captureExceptions', 'CAPTURE_EXCEPTIONS', true],
  ['exceptionLogLevel', 'EXCEPTION_LOG_LEVEL', 'fatal'],
  ['instrument', 'INSTRUMENT', true],
  ['ff_captureFrame', 'FF_CAPTURE_FRAME', false]
]

var falsyValues = [false, 0, '', '0', 'false', 'no', 'off', 'disabled']
var truthyValues = [true, 1, '1', 'true', 'yes', 'on', 'enabled']

var skipBody = function () { return '*' }
var uncaughtExceptionListeners = process._events.uncaughtException
var opbeat

var setup = function () {
  clean()
  uncaughtExceptionListeners = process._events.uncaughtException
  process.removeAllListeners('uncaughtException')
  helpers.mockLogger()
  opbeat = new Agent()
}

var clean = function () {
  global.__opbeat_initialized = null
  process._events.uncaughtException = uncaughtExceptionListeners
  helpers.restoreLogger()
  if (opbeat) opbeat._filters = []
}

optionFixtures.forEach(function (fixture) {
  if (fixture[1]) {
    test('should be configurable by envrionment variable OPBEAT_' + fixture[1], function (t) {
      setup()
      var bool = typeof fixture[2] === 'boolean'
      var value = bool ? (fixture[2] ? '0' : '1') : 'custom-value'
      process.env['OPBEAT_' + fixture[1]] = value
      opbeat.start()
      t.equal(opbeat[fixture[0]], bool ? !fixture[2] : value)
      delete process.env['OPBEAT_' + fixture[1]]
      t.end()
    })

    test('should overwrite OPBEAT_' + fixture[1] + ' by option property ' + fixture[0], function (t) {
      setup()
      var opts = {}
      var bool = typeof fixture[2] === 'boolean'
      var value1 = bool ? (fixture[2] ? '0' : '1') : 'overwriting-value'
      var value2 = bool ? (fixture[2] ? '1' : '0') : 'custom-value'
      opts[fixture[0]] = value1
      process.env['OPBEAT_' + fixture[1]] = value2
      opbeat.start(opts)
      t.equal(opbeat[fixture[0]], bool ? !fixture[2] : value1)
      delete process.env['OPBEAT_' + fixture[1]]
      t.end()
    })
  }

  test('should default ' + fixture[0] + ' to ' + fixture[2], function (t) {
    setup()
    opbeat.start()
    t.equal(opbeat[fixture[0]], fixture[2])
    t.end()
  })
})

falsyValues.forEach(function (val) {
  test('should be disabled by envrionment variable OPBEAT_ACTIVE set to: ' + util.inspect(val), function (t) {
    setup()
    process.env.OPBEAT_ACTIVE = val
    opbeat.start({ appName: 'foo', organizationId: 'bar', secretToken: 'baz' })
    t.equal(opbeat.active, false)
    delete process.env.OPBEAT_ACTIVE
    t.end()
  })
})

truthyValues.forEach(function (val) {
  test('should be enabled by envrionment variable OPBEAT_ACTIVE set to: ' + util.inspect(val), function (t) {
    setup()
    process.env.OPBEAT_ACTIVE = val
    opbeat.start({ appName: 'foo', organizationId: 'bar', secretToken: 'baz' })
    t.equal(opbeat.active, true)
    delete process.env.OPBEAT_ACTIVE
    t.end()
  })
})

test('should overwrite OPBEAT_ACTIVE by option property active', function (t) {
  setup()
  var opts = { appName: 'foo', organizationId: 'bar', secretToken: 'baz', active: false }
  process.env.OPBEAT_ACTIVE = '1'
  opbeat.start(opts)
  t.equal(opbeat.active, false)
  delete process.env.OPBEAT_ACTIVE
  t.end()
})

test('should default active to true if required options have been specified', function (t) {
  setup()
  opbeat.start({ appName: 'foo', organizationId: 'bar', secretToken: 'baz' })
  t.equal(opbeat.active, true)
  t.end()
})

test('should default active to false if required options have not been specified', function (t) {
  setup()
  opbeat.start()
  t.equal(opbeat.active, false)
  t.end()
})

test('should force active to false if required options have not been specified', function (t) {
  setup()
  opbeat.start({ active: true })
  t.equal(opbeat.active, false)
  t.end()
})

test('should default to empty request blacklist arrays', function (t) {
  setup()
  opbeat.start()
  t.equal(opbeat._ignoreUrlStr.length, 0)
  t.equal(opbeat._ignoreUrlRegExp.length, 0)
  t.equal(opbeat._ignoreUserAgentStr.length, 0)
  t.equal(opbeat._ignoreUserAgentRegExp.length, 0)
  t.end()
})

test('should separate strings and regexes into their own blacklist arrays', function (t) {
  setup()
  opbeat.start({
    ignoreUrls: ['str1', /regex1/],
    ignoreUserAgents: ['str2', /regex2/]
  })

  t.deepEqual(opbeat._ignoreUrlStr, ['str1'])
  t.deepEqual(opbeat._ignoreUserAgentStr, ['str2'])

  t.equal(opbeat._ignoreUrlRegExp.length, 1)
  t.ok(isRegExp(opbeat._ignoreUrlRegExp[0]))
  t.equal(opbeat._ignoreUrlRegExp[0].toString(), '/regex1/')

  t.equal(opbeat._ignoreUserAgentRegExp.length, 1)
  t.ok(isRegExp(opbeat._ignoreUserAgentRegExp[0]))
  t.equal(opbeat._ignoreUserAgentRegExp[0].toString(), '/regex2/')

  t.end()
})

test('#setUserContext()', function (t) {
  t.test('no active transaction', function (t) {
    setup()
    opbeat.start()
    t.equal(opbeat.setUserContext({foo: 1}), false)
    t.end()
  })

  t.test('active transaction', function (t) {
    setup()
    opbeat.start()
    var trans = opbeat.startTransaction()
    t.equal(opbeat.setUserContext({foo: 1}), true)
    t.deepEqual(trans._context, {user: {foo: 1}})
    t.end()
  })
})

test('#setExtraContext()', function (t) {
  t.test('no active transaction', function (t) {
    setup()
    opbeat.start()
    t.equal(opbeat.setExtraContext({foo: 1}), false)
    t.end()
  })

  t.test('active transaction', function (t) {
    setup()
    opbeat.start()
    var trans = opbeat.startTransaction()
    t.equal(opbeat.setExtraContext({foo: 1}), true)
    t.deepEqual(trans._context, {extra: {foo: 1}})
    t.end()
  })
})

test('#captureError()', function (t) {
  t.test('should send a plain text message to Opbeat server', function (t) {
    setup()
    opbeat.start(opts)
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(skipBody)
      .defaultReplyHeaders({'Location': 'foo'})
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/errors/', '*')
      .reply(200)

    opbeat.on('logged', function (result) {
      scope.done()
      t.equal(result, 'foo')
      t.end()
    })
    opbeat.captureError('Hey!')
  })

  t.test('should emit error when request returns non 200', function (t) {
    setup()
    opbeat.start(opts)
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(skipBody)
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/errors/', '*')
      .reply(500, { error: 'Oops!' })

    opbeat.on('error', function () {
      scope.done()
      t.end()
    })
    opbeat.captureError('Hey!')
  })

  t.test('shouldn\'t shit it\'s pants when error is emitted without a listener', function (t) {
    setup()
    opbeat.start(opts)
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(skipBody)
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/errors/', '*')
      .reply(500, { error: 'Oops!' })

    opbeat.captureError('Hey!')
    setTimeout(function () {
      scope.done()
      t.end()
    }, 50)
  })

  t.test('should attach an Error object when emitting error', function (t) {
    setup()
    opbeat.start(opts)
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(skipBody)
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/errors/', '*')
      .reply(500, { error: 'Oops!' })

    opbeat.on('error', function (err) {
      scope.done()
      t.equal(err.message, 'Opbeat error (500): {"error":"Oops!"}')
      t.end()
    })

    opbeat.captureError('Hey!')
  })

  t.test('should use `param_message` as well as `message` if given an object as 1st argument', function (t) {
    setup()
    opbeat.start(opts)
    var oldErrorFn = request.error
    request.error = function (agent, data, cb) {
      t.ok('message' in data)
      t.ok('param_message' in data)
      t.equal(data.message, 'Hello World')
      t.equal(data.param_message, 'Hello %s')
      request.error = oldErrorFn
      t.end()
    }
    opbeat.captureError({ message: 'Hello %s', params: ['World'] })
  })

  t.test('should send an Error to Opbeat server', function (t) {
    setup()
    opbeat.start(opts)
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(skipBody)
      .defaultReplyHeaders({'Location': 'foo'})
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/errors/', '*')
      .reply(200)

    opbeat.on('logged', function (result) {
      scope.done()
      t.equal(result, 'foo')
      t.end()
    })
    opbeat.captureError(new Error('wtf?'))
  })

  t.test('should use filters if provided', function (t) {
    t.plan(3)
    setup()
    var opts = {
      appName: 'foo',
      organizationId: 'bar',
      secretToken: 'baz'
    }
    opbeat.addFilter(function (data) {
      t.equal(++data.extra.order, 1)
      return data
    })
    opbeat.addFilter(function (data) {
      t.equal(++data.extra.order, 2)
      return {extra: {owned: true}}
    })
    opbeat.start(opts)
    var oldErrorFn = request.error
    request.error = function (agent, data, cb) {
      t.deepEqual(data.extra, {owned: true})
      request.error = oldErrorFn
    }
    opbeat.captureError(new Error('foo'), {extra: {order: 0}})
  })

  t.test('should abort if any filter returns falsy', function (t) {
    setup()
    var opts = {
      appName: 'foo',
      organizationId: 'bar',
      secretToken: 'baz'
    }
    opbeat.addFilter(function () {})
    opbeat.addFilter(function () {
      t.fail('should not 2nd filter')
    })
    opbeat.start(opts)
    var oldErrorFn = request.error
    request.error = function () {
      t.fail('should not send error to intake')
    }
    opbeat.captureError(new Error(), {}, function () {
      request.error = oldErrorFn
      t.end()
    })
  })

  t.test('should anonymize the http Authorization header by default', function (t) {
    t.plan(2)
    setup()
    opbeat.start({ appName: 'foo', organizationId: 'bar', secretToken: 'baz' })

    var oldErrorFn = request.error
    request.error = function (agent, data, cb) {
      t.equal(data.http.headers.authorization, '[REDACTED]')
      request.error = oldErrorFn
    }

    var server = http.createServer(function (req, res) {
      opbeat.captureError(new Error('foo'), { request: req })
      res.end()
    })

    server.listen(function () {
      http.request({
        port: server.address().port,
        headers: { Authorization: 'secret' }
      }, function (res) {
        res.resume()
        res.on('end', function () {
          server.close()
          t.ok(true)
        })
      }).end()
    })
  })

  t.test('should not anonymize the http Authorization header if disabled', function (t) {
    t.plan(2)
    setup()
    opbeat.start({
      appName: 'foo',
      organizationId: 'bar',
      secretToken: 'baz',
      filterHttpHeaders: false
    })

    var oldErrorFn = request.error
    request.error = function (agent, data, cb) {
      t.equal(data.http.headers.authorization, 'secret')
      request.error = oldErrorFn
    }

    var server = http.createServer(function (req, res) {
      opbeat.captureError(new Error('foo'), { request: req })
      res.end()
    })

    server.listen(function () {
      http.request({
        port: server.address().port,
        headers: { Authorization: 'secret' }
      }, function (res) {
        res.resume()
        res.on('end', function () {
          server.close()
          t.ok(true)
        })
      }).end()
    })
  })

  t.test('should merge context', function (t) {
    setup()
    opbeat.start({
      appName: 'foo',
      organizationId: 'bar',
      secretToken: 'baz',
      filterHttpHeaders: false
    })

    var oldErrorFn = request.error
    request.error = function (agent, data, cb) {
      t.deepEqual(data.user, {a: 1, b: 1, merge: {shallow: true}})
      t.deepEqual(data.extra, {a: 3, b: 2, merge: {shallow: true}, node: process.version, uuid: data.extra.uuid})
      request.error = oldErrorFn
      t.end()
    }

    var server = http.createServer(function (req, res) {
      opbeat.startTransaction()
      t.equal(opbeat.setUserContext({a: 1, merge: {a: 2}}), true)
      t.equal(opbeat.setExtraContext({a: 3, merge: {a: 4}}), true)
      opbeat.captureError(new Error('foo'), {user: {b: 1, merge: {shallow: true}}, extra: {b: 2, merge: {shallow: true}}})
      res.end()
    })

    server.listen(function () {
      http.request({
        port: server.address().port
      }, function (res) {
        res.resume()
        res.on('end', function () {
          server.close()
        })
      }).end()
    })
  })
})

test('#handleUncaughtExceptions()', function (t) {
  t.test('should add itself to the uncaughtException event list', function (t) {
    setup()
    t.equal(process._events.uncaughtException, undefined)
    opbeat.start(opts)
    opbeat.handleUncaughtExceptions()
    t.equal(process._events.uncaughtException.length, 1)
    t.end()
  })

  t.test('should not add more than one listener for the uncaughtException event', function (t) {
    setup()
    opbeat.start(opts)
    opbeat.handleUncaughtExceptions()
    var before = process._events.uncaughtException.length
    opbeat.handleUncaughtExceptions()
    t.equal(process._events.uncaughtException.length, before)
    t.end()
  })

  t.test('should send an uncaughtException to Opbeat server', function (t) {
    setup()

    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(skipBody)
      .defaultReplyHeaders({'Location': 'foo'})
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/errors/', '*')
      .reply(200)

    opbeat.start(opts)
    opbeat.handleUncaughtExceptions(function (err, url) {
      t.ok(isError(err))
      scope.done()
      t.equal(url, 'foo')
      t.end()
    })

    process.emit('uncaughtException', new Error('derp'))
  })
})

test('#trackRelease()', function (t) {
  t.test('should send release request to the Opbeat server with given rev', function (t) {
    setup()
    opbeat.start(opts)
    var buffer
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(function (body) {
        buffer = new Buffer(body, 'hex') // eslint-disable-line node/no-deprecated-api
        return '*'
      })
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/releases/', '*')
      .reply(200)

    opbeat.trackRelease({ rev: 'foo' }, function () {
      scope.done()
      zlib.inflate(buffer, function (err, buffer) {
        t.error(err)
        var body = JSON.parse(buffer.toString())
        t.equal(Object.keys(body).length, 3)
        t.equal(body.status, 'completed')
        t.equal(body.rev, 'foo')
        t.ok('branch' in body)
        t.equal(typeof body.branch, 'string')
        t.ok(body.branch.length > 0)
        t.end()
      })
    })
  })

  t.test('should send release request to the Opbeat server with given rev and branch', function (t) {
    setup()
    opbeat.start(opts)
    var buffer
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(function (body) {
        buffer = new Buffer(body, 'hex') // eslint-disable-line node/no-deprecated-api
        return '*'
      })
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/releases/', '*')
      .reply(200)

    opbeat.trackRelease({ rev: 'foo', branch: 'bar' }, function () {
      scope.done()
      zlib.inflate(buffer, function (err, buffer) {
        t.error(err)
        var body = JSON.parse(buffer.toString())
        t.equal(Object.keys(body).length, 3)
        t.equal(body.status, 'completed')
        t.equal(body.rev, 'foo')
        t.equal(body.branch, 'bar')
        t.end()
      })
    })
  })

  t.test('should send release request to the Opbeat server with given rev and branch automatically generated', function (t) {
    setup()
    opbeat.start(opts)
    var buffer
    var scope = nock('https://intake.opbeat.com')
      .filteringRequestBody(function (body) {
        buffer = new Buffer(body, 'hex') // eslint-disable-line node/no-deprecated-api
        return '*'
      })
      .post('/api/v1/organizations/some-org-id/apps/some-app-name/releases/', '*')
      .reply(200)

    opbeat.trackRelease(function () {
      scope.done()
      zlib.inflate(buffer, function (err, buffer) {
        t.error(err)
        var body = JSON.parse(buffer.toString())
        t.equal(Object.keys(body).length, 3)
        t.equal(body.status, 'completed')
        t.ok(/^[\da-f]{40}$/.test(body.rev))
        t.ok('branch' in body)
        t.equal(typeof body.branch, 'string')
        t.ok(body.branch.length > 0)
        t.end()
      })
    })
  })
})

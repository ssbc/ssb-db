'use strict'
var tape = require('tape')
var pull = require('pull-stream')
var crypto = require('crypto')

var createSSB = require('./util')

module.exports = function (opts) {

    tape('add bulk', function (t) {
        var ssb = createSSB('test-ssb-feed', {})

        var f = ssb.createFeed()

        var messages = [
            {
                type: "test",
                message: "test body"
            },
            {
                type: "test",
                message: "test body 2"
            }
        ]

        f.addBulk(messages, function (err, ary) {
            if (err) throw err
            t.equal(ary.length, 2)
        })


    })

    tape('add bulk single item', function (t) {


    })

    tape('interleave bulk and singular', function (t) {

    })

}

if (!module.parent) { module.exports({}) }
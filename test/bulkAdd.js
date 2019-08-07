'use strict'
var tape = require('tape')
var pull = require('pull-stream')

var multicb = require('multicb')

var createSSB = require('./util')

module.exports = function (opts) {

    tape('add bulk', function (t) {
        var ssb = createSSB('test-ssb-feed-bulk', {})

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

            pull(
                ssb.createFeedStream(),
                pull.collect(function(err,result) {
                    t.equal(result.length, 2)
                    t.end()
                })
            )
        })
    })

    tape('add bulk single item', function (t) {
        var ssb = createSSB('test-ssb-feed-bulk2', {})

        var f = ssb.createFeed()

        var messages = [
            {
                type: "test",
                message: "test body"
            }
        ]

        f.addBulk(messages, function (err, ary) {
            if (err) throw err
            t.equal(ary.length, 1)

            pull(
                ssb.createFeedStream(),
                pull.collect(function(err,result) {
                    t.equal(result.length, 1)
                    t.end()
                })
            )
        })
    })

    tape('interleave bulk and singular', function (t) {

        var ssb = createSSB('test-ssb-feed-bulk3', {})

        var f = ssb.createFeed()

        var done = multicb()

        var messages = [
            {
                type: "test",
                message: "test body single"
            },
            [
                {
                    type: "test",
                    message: "test bulk body 1"
                },
                {
                    type: "test",
                    message: "test body 2"
                }
            ],
            {
                type: "test",
                message: "test body single 2"
            }
        ];

        messages.forEach(message => {
            if (Array.isArray(message)) {
                f.addBulk(message, done())
            } else {
                f.add(message, done())
            }
        })

        done(function(err, results) {
            pull(
                ssb.createFeedStream(),
                pull.collect(function(err, result) {
                    t.equal(result.length, 4)
                    t.end()
                })
            )
        })

    })

}

if (!module.parent) { module.exports({}) }
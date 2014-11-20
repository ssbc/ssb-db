module.exports = {
  decode: function (string) {
    return JSON.parse(string)
  },
  encode: function (obj) {
    return JSON.stringify(obj, null, 2)
  },
  buffer: false
}


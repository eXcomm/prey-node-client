"use strict";

//////////////////////////////////////////
// Prey JS Network Module Windows Functions
// (c) 2011 - Fork Ltd.
// by Tomas Pollak - http://forkhq.com
// GPLv3 Licensed
//////////////////////////////////////////

var wmic     = require('wmic'),
    exec     = require('child_process').exec,
    os       = require('os'),
    release  = parseFloat(os.release());

/**
 * Callsback a list of wireless adapter names.
 **/
exports.get_wireless_interfaces_list = function(callback) {
  var query = 'nic where "Name like \'%Wireless%\'" get NetConnectionID';
  wmic.run(query, function(err, o) {
    if (err) return callback(err);

    var list = o.split("\n").splice(1).map(function(n) { return n.trim(); });
    callback(null, list);
  });
};

/**
 * Returns the MAC address of the active access point.
 **/
exports.get_active_access_point_mac = function(callback) {
  if (release >= 6.0) {
    exec('netsh wlan show interfaces', function(err, stdout) {
      if (err) return callback(err);

      var bssid = stdout.toString().match(/BSSID\s+:\s?(.+)/);
      if (bssid) {
        callback(null, bssid[1]);
      } else {
        callback(new Error('No active access point(s) found.'))
      }
    });
  } else {
    callback(new Error('TODO!'));
  }
};


/////////////////////////////////////////////////////////////////
// access points list fetcher and parser
/////////////////////////////////////////////////////////////////

/**
 * Gets access points list
 * @param {String} wifi_device - should return something like
 * { ssid:"",security:true,quality:23,signal_strength:54,noise_level:24}
 *
 * autowc actually returns {mac_address,ssid,signal_strength,channel,signal_to_noise} this function converts
 **/

exports.get_access_points_list = function(callback) {

  var cmd, parser, list = [];

  var done = function(err){
    if (err || list.length == 0) {
      var e = !err ? new Error("No access points found.")
                   : err.code == 10 ? 'No Wi-Fi adapter found' : err;
      callback(e);
    } else {
      callback(null, list);
    }
  }

  if (release <= 5.2) {
    cmd    = 'autowcxp -list';
    parser = 'autowc';
  } else {
    cmd    = 'netsh wlan show all';
    parser = 'netsh';
  }

  exec(cmd, function(err, out) {
    if (err) return done(err);
    list = exports['parse_access_points_list_' + parser](out);
    done();
  })

};

exports.parse_access_points_list_autowc = function(out) {

  var arr = [];
  try { arr = JSON.parse("[" + out + "]") }
  catch(e) { return arr; };

  if (arr.length === 0)
    return [];

  return arr.map(function(o) {
    return {
      ssid            : o.ssid.replace(/[^\w :'-]/g, ''),
      // security     : null, // don't have this data
      // quality      : null,
      signal_strength : o.signal_strength,
      noise_level     : o.signal_to_noise
    };
  })

}


/* example output: 

SSID 1 : SomewhereWiFi
    Network type            : Infrastructure
    Authentication          : Open
    Encryption              : None 
    BSSID 1                 : aa:bb:cc:11:22:33
         Signal             : 38%  
         Radio type         : 802.11n
         Channel            : 6 
         Basic rates (Mbps) : 1 2 5.5 11
         Other rates (Mbps) : 6 9 12 18 24 36 48 54
    BSSID 2                 : 33:22:11:bb:cc:dd
         Signal             : 40%  
         Radio type         : 802.11n
         Channel            : 4 
         Basic rates (Mbps) : 1 2 5.5 11
         Other rates (Mbps) : 6 9 12 18 24 36 48 54

*/

exports.parse_access_points_list_netsh = function(out) {

  var list   = [],
      blocks = out.split(/\nSSID \d{1,2} : /);

  if (!blocks)
    return [];

  var get_values = function(str) {
    var res = {};
    str.split('\n').forEach(function(line) {
      if (line.toString().trim() == '')
        return;

      var split = line.split(': '),
          key   = split[0].trim(),
          val   = split[1] ? split[1].trim() : null;

      if (key) res[key] = val; 
    })
    return res;
  }

  var build_ap = function(base, router) {
    var obj = {
      ssid        : base['SSID'].toString().trim() == '' ? '(Unknown)' : base['SSID'],
      security    : base['Authentication'] != 'Open' ? base['Authentication'] : null,
      mac_address : router['BSSID']
    }

    // signal is shown as '94%', so we need to substract 100 to get a consistent behaviour with
    // OSX and Linux's signal_strength integer
    if (router['Signal'])
      obj.signal_strength = parseInt(router['Signal']) - 100;

    if (router['Channel'])
      obj.channel = parseInt(router['Channel']);

    return obj;
  }

  blocks.forEach(function(block, i) {
    if (i == 0) return; // first block contains data about the interface and card

    // netsh groups access points by BSSID, so we need to separate each 
    // SSID block into the BSSID it contains and select one of them
    var routers = block.split(/BSSID \d/);

    // the first block will contain shared information: SSID, auth, encryption
    // so parse those values first. insert the SSID part that was removed from line one
    var shared  = 'SSID : ' + routers.shift(),
        main    = get_values(shared);

    var routers = routers.map(function(router_data) { 
      var values = get_values('BSSID' + router_data);

      if (!values['BSSID'] || values['BSSID'].toString().trim() == '')
        return;

      return values;
    }).filter(function(el) { return el }) // remove invalid entries

    // console.log(main['SSID'] + ' has ' + routers.length + ' routers.');
    routers.forEach(function(router) {
      list.push(build_ap(main, router));
    })

  });

  return list;
}

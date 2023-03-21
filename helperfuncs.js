let fs = require("fs");
const axios = require('axios');
global.cwd = process.cwd();

let logToFile = function(text){
	try{
		let now = new Date();
		let year = now.getUTCFullYear();
		let month = now.getUTCMonth()+1;
		let date = now.getUTCDate();
		let filename = `logs/${year}-${month < 10 ? "0" : ""}${month}-${date < 10 ? "0" : ""}${date}.txt`;
		fs.appendFile(filename, `\n[${new Date().toUTCString()}]${text}`,(err) => {
		  if (err) throw err;
		});
	}catch(err){
		console.log("ERROR LOGGING: " + err);
	}
};

global.info = function (text) {
	logToFile(`[INFO] ${text}`);
	console.log('info'.cyan + '  ' + text);
};

global.recv = function (text) {
	logToFile(`[RECEIVE] ${text}`);
	console.log("recv".grey + "  " + text);
};

global.dsend = function (text) {
	logToFile(`[SEND] ${text}`);
	console.log("send".grey + " " + text);
};

global.error = function (text) {
	logToFile(`[ERROR] ${text}`);
	console.log("Error: ".red + text);
};

global.logIfError = function (text) {
	if(text) error(text);
}

global.ok = function (text) {
	logToFile(`[OK] ${text}`);
	console.log(text.green);
};

//Here are some useful functions for all modules to use

// Send to a discord webhook
global.sendWebhook = function(webhook, text){
	axios.post(webhook, {
		content: text
	}).then(res => {
		
	}).catch(error => {
		error(`Post to Discord webhook failed: ${text}`);
	});
};

//Removes characters denoting user ranks from the beginning of a name
global.removeRank = function(text){
	if(typeof text === "string"){
		return text.replace(/^[\s!\+%@#&\?\*]/,"");
	}
	return "";
};

//Removes text formatting from the given string
global.removeFormatting = function(text){
	let reg = /([_~*`^])\1(.+)\1\1/g;
	while(reg.test(text)){
		text = text.replace(reg, "$2");
	}
	reg = /\[\[(.+)\]\]/g;
	while(reg.test(text)){
		text = text.replace(reg, "$1");
	}
	return text;
}

//Removes all non-alphanumeric characters from text, and makes it lower case
global.toId = function(text){
	if(typeof text === "string"){
		return text.toLowerCase().replace(/[^a-z\d]/g,"");
	}
	return "";
};

//Replaces characters that may interfere with HTML
global.makeHTMLFriendly = function(text){
	if(typeof text === "string"){
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	}
	return "";
}

//Removes all non-alphanumeric characters from text except hyphens, and makes it lower case
global.toRoomId = function(text){
	if(typeof text === "string"){
		return text.toLowerCase().replace(/[^a-z\d\-]/g,"");
	}
	return "";
};

global.idsMatch = function(n1, n2){
	return toId(n1) === toId(n2) && typeof n1 === "string" && typeof n2 === "string";
};

global.prettyList = function(arr){
	if(arr.length == 1){
		return arr[0];
	}else if(arr.length == 2){
		return arr[0] + " and " + arr[1];
	}else if(arr.length > 2){
		return arr.slice(0,arr.length-1).join(", ") + ", and " + arr[arr.length-1];
	}
	return "";
};

// Returns a random permutation of arr
global.shuffle = function(arr){
	let newarr, tmp, j;
	newarr = arr.slice(0)
	for(let i=arr.length-1; i>0; i--){
		j = Math.floor(Math.random()*(i+1));
		tmp = newarr[i];
		newarr[i] = newarr[j];
		newarr[j] = tmp
	}
	return newarr;
};

global.millisToTime = function(millis){
	let seconds = millis/1000;
	let hours = Math.floor(seconds/3600);
	let minutes = Math.floor((seconds-hours*3600)/60);
	let response;
	if(hours>0){
		response = `${hours} hour${hours === 1 ? "" : "s"} and ${minutes} minute${minutes === 1 ? "" : "s"}`;
	}else{
		response = `minutes} minute${minutes === 1 ? "" : "s"}`;
	}
	return response;
};

// Saves text to somewhere accessible via the internet, and returns the link used to access it.
// callback(err, address)
global.uploadText = function(text, callback, extension='txt'){
	let filename = `${MD5(text.substr(0,10)+Date.now())}.${extension}`;
	try{
		let textFile = fs.openSync(bot.config.text_directory.value + filename,"w");
		fs.writeSync(textFile,text,null,'utf8');
		fs.closeSync(textFile);
		callback(null, bot.config.text_web_directory.value + filename);
	}catch(e){
		error(e.message);
		callback("Could not save the text file.");
	}
};

// to be implemented
global.parseText = function(link, callback){

};

global.hashColour = function(name) {
	var hash = MD5(name);
	var H = parseInt(hash.substr(4, 4), 16) % 360; // 0 to 360
	var S = parseInt(hash.substr(0, 4), 16) % 50 + 40; // 40 to 89
	var L = Math.floor(parseInt(hash.substr(8, 4), 16) % 20 + 30); // 30 to 49

	var C = (100 - Math.abs(2 * L - 100)) * S / 100 / 100;
	var X = C * (1 - Math.abs((H / 60) % 2 - 1));
	var m = L / 100 - C / 2;

	var R1, G1, B1;
	switch (Math.floor(H / 60)) {
	case 1: R1 = X; G1 = C; B1 = 0; break;
	case 2: R1 = 0; G1 = C; B1 = X; break;
	case 3: R1 = 0; G1 = X; B1 = C; break;
	case 4: R1 = X; G1 = 0; B1 = C; break;
	case 5: R1 = C; G1 = 0; B1 = X; break;
	case 0: default: R1 = C; G1 = X; B1 = 0; break;
	}
	var R = R1 + m, G = G1 + m, B = B1 + m;
	var lum = R * R * R * 0.2126 + G * G * G * 0.7152 + B * B * B * 0.0722; // 0.013 (dark blue) to 0.737 (yellow)

	var HLmod = (lum - 0.2) * -150; // -80 (yellow) to 28 (dark blue)
	if (HLmod > 18) HLmod = (HLmod - 18) * 2.5;
	else if (HLmod < 0) HLmod = (HLmod - 0) / 3;
	else HLmod = 0;
	// var mod = ';border-right: ' + Math.abs(HLmod) + 'px solid ' + (HLmod > 0 ? 'red' : '#0088FF');
	var Hdist = Math.min(Math.abs(180 - H), Math.abs(240 - H));
	if (Hdist < 15) {
		HLmod += (15 - Hdist) / 3;
	}

	L += HLmod;

	return hslToHex(H, S, L);
}

// MD5 and hashColour taken from PS code
// hslToHex from https://stackoverflow.com/a/44134328
global.hslToHex = function(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = x => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

global.MD5 = function(f){function i(b,c){var d,e,f,g,h;f=b&2147483648;g=c&2147483648;d=b&1073741824;e=c&1073741824;h=(b&1073741823)+(c&1073741823);return d&e?h^2147483648^f^g:d|e?h&1073741824?h^3221225472^f^g:h^1073741824^f^g:h^f^g}function j(b,c,d,e,f,g,h){b=i(b,i(i(c&d|~c&e,f),h));return i(b<<g|b>>>32-g,c)}function k(b,c,d,e,f,g,h){b=i(b,i(i(c&e|d&~e,f),h));return i(b<<g|b>>>32-g,c)}function l(b,c,e,d,f,g,h){b=i(b,i(i(c^e^d,f),h));return i(b<<g|b>>>32-g,c)}function m(b,c,e,d,f,g,h){b=i(b,i(i(e^(c|~d),
	f),h));return i(b<<g|b>>>32-g,c)}function n(b){var c="",e="",d;for(d=0;d<=3;d++)e=b>>>d*8&255,e="0"+e.toString(16),c+=e.substr(e.length-2,2);return c}var g=[],o,p,q,r,b,c,d,e,f=function(b){for(var b=b.replace(/\r\n/g,"\n"),c="",e=0;e<b.length;e++){var d=b.charCodeAt(e);d<128?c+=String.fromCharCode(d):(d>127&&d<2048?c+=String.fromCharCode(d>>6|192):(c+=String.fromCharCode(d>>12|224),c+=String.fromCharCode(d>>6&63|128)),c+=String.fromCharCode(d&63|128))}return c}(f),g=function(b){var c,d=b.length;c=
	d+8;for(var e=((c-c%64)/64+1)*16,f=Array(e-1),g=0,h=0;h<d;)c=(h-h%4)/4,g=h%4*8,f[c]|=b.charCodeAt(h)<<g,h++;f[(h-h%4)/4]|=128<<h%4*8;f[e-2]=d<<3;f[e-1]=d>>>29;return f}(f);b=1732584193;c=4023233417;d=2562383102;e=271733878;for(f=0;f<g.length;f+=16)o=b,p=c,q=d,r=e,b=j(b,c,d,e,g[f+0],7,3614090360),e=j(e,b,c,d,g[f+1],12,3905402710),d=j(d,e,b,c,g[f+2],17,606105819),c=j(c,d,e,b,g[f+3],22,3250441966),b=j(b,c,d,e,g[f+4],7,4118548399),e=j(e,b,c,d,g[f+5],12,1200080426),d=j(d,e,b,c,g[f+6],17,2821735955),c=
	j(c,d,e,b,g[f+7],22,4249261313),b=j(b,c,d,e,g[f+8],7,1770035416),e=j(e,b,c,d,g[f+9],12,2336552879),d=j(d,e,b,c,g[f+10],17,4294925233),c=j(c,d,e,b,g[f+11],22,2304563134),b=j(b,c,d,e,g[f+12],7,1804603682),e=j(e,b,c,d,g[f+13],12,4254626195),d=j(d,e,b,c,g[f+14],17,2792965006),c=j(c,d,e,b,g[f+15],22,1236535329),b=k(b,c,d,e,g[f+1],5,4129170786),e=k(e,b,c,d,g[f+6],9,3225465664),d=k(d,e,b,c,g[f+11],14,643717713),c=k(c,d,e,b,g[f+0],20,3921069994),b=k(b,c,d,e,g[f+5],5,3593408605),e=k(e,b,c,d,g[f+10],9,38016083),
	d=k(d,e,b,c,g[f+15],14,3634488961),c=k(c,d,e,b,g[f+4],20,3889429448),b=k(b,c,d,e,g[f+9],5,568446438),e=k(e,b,c,d,g[f+14],9,3275163606),d=k(d,e,b,c,g[f+3],14,4107603335),c=k(c,d,e,b,g[f+8],20,1163531501),b=k(b,c,d,e,g[f+13],5,2850285829),e=k(e,b,c,d,g[f+2],9,4243563512),d=k(d,e,b,c,g[f+7],14,1735328473),c=k(c,d,e,b,g[f+12],20,2368359562),b=l(b,c,d,e,g[f+5],4,4294588738),e=l(e,b,c,d,g[f+8],11,2272392833),d=l(d,e,b,c,g[f+11],16,1839030562),c=l(c,d,e,b,g[f+14],23,4259657740),b=l(b,c,d,e,g[f+1],4,2763975236),
	e=l(e,b,c,d,g[f+4],11,1272893353),d=l(d,e,b,c,g[f+7],16,4139469664),c=l(c,d,e,b,g[f+10],23,3200236656),b=l(b,c,d,e,g[f+13],4,681279174),e=l(e,b,c,d,g[f+0],11,3936430074),d=l(d,e,b,c,g[f+3],16,3572445317),c=l(c,d,e,b,g[f+6],23,76029189),b=l(b,c,d,e,g[f+9],4,3654602809),e=l(e,b,c,d,g[f+12],11,3873151461),d=l(d,e,b,c,g[f+15],16,530742520),c=l(c,d,e,b,g[f+2],23,3299628645),b=m(b,c,d,e,g[f+0],6,4096336452),e=m(e,b,c,d,g[f+7],10,1126891415),d=m(d,e,b,c,g[f+14],15,2878612391),c=m(c,d,e,b,g[f+5],21,4237533241),
	b=m(b,c,d,e,g[f+12],6,1700485571),e=m(e,b,c,d,g[f+3],10,2399980690),d=m(d,e,b,c,g[f+10],15,4293915773),c=m(c,d,e,b,g[f+1],21,2240044497),b=m(b,c,d,e,g[f+8],6,1873313359),e=m(e,b,c,d,g[f+15],10,4264355552),d=m(d,e,b,c,g[f+6],15,2734768916),c=m(c,d,e,b,g[f+13],21,1309151649),b=m(b,c,d,e,g[f+4],6,4149444226),e=m(e,b,c,d,g[f+11],10,3174756917),d=m(d,e,b,c,g[f+2],15,718787259),c=m(c,d,e,b,g[f+9],21,3951481745),b=i(b,o),c=i(c,p),d=i(d,q),e=i(e,r);return(n(b)+n(c)+n(d)+n(e)).toLowerCase()};

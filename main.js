"use strict";
console.log("Starting the bot");
require('babel/register')({loose: 'all'});
require('sugar');

//Various logging commands for output to the console
let colors = require('colors');
let messageQueue = [];
let lastMessageTime = 0;
let messageTimeout = null;
const MESSAGE_THROTTLE = 700;
const main_defaults = {
	"user": "",
	"pass": "",
	"owner": "",
	"connection": "ws://sim.smogon.com/showdown/websocket",
	"log_receive": true,
	"log_send": true,
	"dbuser": "",
	"dbpassword": "",
	"dbhost": "",
	"dbport": 0,
	"dbname": ""
}

let logToFile = function(text){
	try{
		let now = new Date();
		let year = now.getUTCFullYear();
		let month = now.getUTCMonth()+1;
		let date = now.getUTCDate();
		let filename = "logs/" + year + "-" + (month < 10 ? "0" : "") + month + "-" + (date < 10 ? "0" : "") + date + ".txt";
		fs.appendFile(filename, "\n[" + new Date().toUTCString() + "]" + text,(err) => {
		  if (err) throw err;
		});
	}catch(err){
		console.log("ERROR LOGGING: " + err);
	}
};

global.info = function (text) {
	logToFile("[INFO] " + text);
	console.log('info'.cyan + '  ' + text);
};

global.recv = function (text) {
	logToFile("[RECEIVE] " + text);
	console.log('recv'.grey + '  ' + text);
};

global.dsend = function (text) {
	logToFile("[SEND] " + text);
	console.log('send'.grey + '  ' + text);
};

global.error = function (text) {
	logToFile("[ERROR] " + text);
	console.log("Error: ".red + text);
};

global.ok = function (text) {
	logToFile("[OK] " + text);
	console.log(text.green);
};

info("Just defined logging commands");

let fs = require("fs");

global.loadConfig = function(name, defaults){
	name = toId(name);
	let path = "config/" + name + "_config.json";
	let newConfig = {};
	if(modules[name] || name === "main"){
		let shouldSave = false;
		if(fs.existsSync(path)){
			newConfig = JSON.parse(fs.readFileSync(path, "utf8"));
		}
		for(let setting in defaults){
			if(typeof defaults[setting] !== typeof newConfig[setting]){
				shouldSave = true;
				newConfig[setting] = defaults[setting];
			}
		}

		if(name === "main"){
			mainConfig = newConfig;
			if(shouldSave) saveConfig(name);
			if(!mainConfig.user || !mainConfig.pass){
				error("The main config file is missing login information. Please fill it in and re-run the bot.");
				process.exit(0);
			}
		}else{
			modules[name].config = newConfig;
			if(shouldSave) saveConfig(name);
		}
		return true;
	}else{
		//Tried to load config for non-existant module.
		return false;
	}
};

global.saveConfig = function(name){
	let filename = "config/" + name + "_config.json";
	if((modules[name] && modules[name].config) || name === "main"){
		try{
			let configFile = fs.openSync(filename,"w");
			let config = name === "main" ? mainConfig : modules[name].config;
			fs.writeSync(configFile,JSON.stringify(config, null, "\t"));
			fs.closeSync(configFile);
		}catch(e){
			error(e.message);
			info("Could not save the config file " + filename);
		}
	}else{
		info("Tried to save the config for the non-existant module " + name);
	}
};

//Manages the bot modules
global.modules = {};
global.loadModule = function(name, loadData){
	let path = "./bot_modules/" + name;
	try{
		delete require.cache[require.resolve(path)];
		let requiredBy = [];
		let module = modules[name];
		if(module){
			requiredBy = module.requiredBy;
			if(loadData && module.js && module.js.onUnload){
				module.js.onUnload();
			}
		}else{
			module = {js:null,data:null,requiredBy:[],hooks:{},config:{}};
		}
		modules[name] = module;
		module.hooks = {};
		module.js = require(path);
		loadConfig(name, module.js.defaultConfigs || {});
		module.js.onLoad(module, loadData);

		for(let i=0;i<requiredBy.length;i++){
			let requiredByModule = modules[requiredBy[i]];
			if(requiredByModule&&requiredByModule.js){
				requiredByModule.js.refreshDependencies();
			}
		}
		return true;
	}catch(e){
		error(e.message);
		info("Could not load the module " + name);
	}
	return false;
};
global.unloadModule = function(name){
	if(modules[name]){
		let path = "./bot_modules/" + name;
		delete require.cache[require.resolve(path)];
		let requiredBy = modules[name].requiredBy;
		if(modules[name].js.onUnload){
			modules[name].js.onUnload();
		}
		delete modules[name];
		for(let i=0;i<requiredBy.length;i++){
			let module = modules[requiredBy[i]];
			if(module && module.js){
				module.js.refreshDependencies();
			}
		}
		return true;
	}
	return false;

};
global.getModuleForDependency = function(name, from){
	let module = modules[name];
	if(module){
		if(module.requiredBy.indexOf(from)===-1){
			module.requiredBy.add(from);
		}
	}else{
		modules[name] = {js:null,data:null,requiredBy:[from],hooks:null};
	}
	return modules[name];
};

let stdin = process.openStdin();
stdin.addListener("data", function(d) {
	let text = d.toString().substring(0, d.length-1);
	send(text);
});


let request = require("request");
let WebSocketClient = require('websocket').client;
let Connection = null;

var connect = function (retry, delay) {
	if (retry) {
		info('Retrying...');
	}

	var ws = new WebSocketClient();

	ws.on('connectFailed', function (err) {
		error('Could not connect');
		error(err)
		info('Retrying in ' + (delay/1000) + ' seconds');

		setTimeout(()=>{
			connect(true, delay*2);
		}, delay);
	});

	ws.on('connect', function (con) {
		Connection = con;
		ok('Connected to server');

		// If we successfully connect, reset the delay
		let delay = 30000;


		con.on('error', function (err) {
			error('Connection error: ' + err.stack);
			con.drop();
		});

		con.on('close', function (code, reason) {
			// Set Connection to null so everything knows we lost connection
			Connection = null;

			error('Connection closed: ' + reason + ' (' + code + ')');
			info('Retrying in ' + (delay/1000) + ' seconds.');

			setTimeout(()=>{
				connect(true, delay*2);
			}, delay);
		});

		con.on('message', function (response) {
			try{
				if (response.type !== 'utf8'){
					info(JSON.stringify(response));
					return false;
				}
				var message = response.utf8Data;
				if(mainConfig.log_receive){
					recv(message);
				}
				handle(message);
			}catch(e){
				error(e.message);
			}
		});
		if(messageQueue.length && !messageTimeout){
			messageTimeout = setTimeout(trySendMessage, MESSAGE_THROTTLE);
		}
	});

	// The connection itself

	info("Connecting to " + mainConfig.connection);
	ws.connect(mainConfig.connection);
};

let trySendMessage = function(){
	if(messageTimeout){
		clearTimeout(messageTimeout);
		messageTimeout = null;
	}
	if(messageQueue.length && Connection && (Date.now() - lastMessageTime) > MESSAGE_THROTTLE){
		try{
			lastMessageTime = Date.now();
			Connection.send(messageQueue[0]);
			if(mainConfig.log_send){
				dsend(messageQueue[0]);
			}
			messageQueue.shift();
		}catch(e){
			error(e.message);
		}
	}
	if(messageQueue.length && Connection){
		messageTimeout = setTimeout(()=>{
			trySendMessage();
		}, MESSAGE_THROTTLE + 5);
	}
}

global.send = function (data) {
	if (!data || !Connection || !Connection.connected) return false;
	messageQueue.push(data);
	if(!messageTimeout){
		let now = Date.now();
		if(now - lastMessageTime > MESSAGE_THROTTLE){
			trySendMessage();
		}else{
			messageTimeout = setTimeout(trySendMessage,(now - lastMessageTime) - MESSAGE_THROTTLE + 5);
		}
	}
};


function handle(message){
	let chunks = message.split("\n");
	let room;
	let isInit = false;
	if(chunks[0][0]==">"){
		room = chunks.splice(0,1)[0].substr(1);
	}else{
		room = "lobby";
	}
	for(let i=0;i<chunks.length;i++){
		let args = chunks[i].split("|");
		if(args[1]=="challstr"){
			request.post(
				{
					url : "http://play.pokemonshowdown.com/action.php",
					formData : {
						act: "login",
						name: mainConfig.user,
						pass: mainConfig.pass,
						challengekeyid: args[2],
						challenge: args[3]
					}
				},
				function (err, response, body) {
					let data;
					if(!body||body.length < 1){
						body = null;
					}else{
						if(body[0]=="]"){
							body = body.substr(1);
						}
						data = JSON.parse(body);
					}
					if(data && data.curuser && data.curuser.loggedin) {
						send("|/trn " + mainConfig.user + ",0," + data.assertion);
					} else {
						// We couldn't log in for some reason
						error("Error logging in...");
						process.exit(1);
					}
			});
		}else if(args[1]=="updateuser"&&args[2].toLowerCase()==mainConfig.user.toLowerCase()){
			send("|/avatar 162");
			for(let modulename in modules){
				let module = modules[modulename];
				if(module && module.js && module.js.onConnect){
					module.js.onConnect();
				}
			}
		}else{
			if(args[1]==="init"){
				isInit = true;
				chunks = chunks.splice(0,4)
			}
			let chatInfo = getChatInfo(room, args, isInit);
			for(let modulename in modules){
				let module = modules[modulename];
				if(module&&module.messagehooks){
					for(let hookname in module.messagehooks){
						try{
							module.messagehooks[hookname](room, args, isInit);
						}catch(e){
							error(e.message);
							info("Exception while trying message hook from " + modulename + "(hook: " + hookname + ")");
						}
					}
				}
				if(module&&module.chathooks&&!isInit){
					for(let hookname in module.chathooks){
						try{
							module.chathooks[hookname](chatInfo);
						}catch(e){
							error(e.message);
							info("Exception while trying chat hook from " + modulename + "(hook: " + hookname + ")");
						}
					}
				}
			}
		}
	}
}

//Here are some useful functions for all modules to use

global.getChatInfo = function(room, args, isInit){
	let messageInfo = null;
	if(args.length>=4){
		if(args[1]==="pm"){
			messageInfo = {
				room: "",
				source: "pm",
				user: args[2].trim(),
				isInit: isInit,
				message: args.slice(4,args.length).join("|")
			};
		}else if(args[1]==="c:"){
			messageInfo = {
				room: room,
				source: "chat",
				user: args[3].trim(),
				isInit: isInit,
				message: args.slice(4,args.length).join("|")
			};
		}else if(args[1]==="c"||args[1]==="chat"){
			messageInfo = {
				room: room,
				source: "chat",
				user: args[2].trim(),
				isInit: isInit,
				message: args.slice(3,args.length).join("|")
			};
		}
	}
	return messageInfo;
};

//Removes characters denoting user ranks from the beginning of a name
global.removeRank = function(text){
	if(typeof text === "string"){
		return text.replace(/^[\s!\+%@#&\?\*]/,"");
	}
	return "";
};

//Removes all non-alphanumeric characters from text, and makes it lower case
global.toId = function(text){
	if(typeof text === "string"){
		return text.toLowerCase().replace(/[^a-z\d]/g,"");
	}
	return "";
};

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


//onSuccess takes one argument (the hastebin link), and onError takes on argument (the string failure reason)
global.uploadText = function(text, onSuccess, onError){
	request.post({url:'https://hastebin.com/documents', body: text}, function(err,httpResponse,body){
		if(err){
			error(JSON.stringify(err));
			onError(JSON.stringify(err));
		}else{
			onSuccess("hastebin.com/" + JSON.parse(body).key);
		}
	});
};

//onSuccess takes on argument (the text), and onError takes on argument (the failure reason)
global.parseText = function(link, onSuccess, onError){

};

global.cwd = process.cwd();

//Create necessary folders
if (!fs.existsSync("./config")){
	fs.mkdirSync("./config");
}
if (!fs.existsSync("./data")){
	fs.mkdirSync("./data");
}
if (!fs.existsSync("./logs")){
	fs.mkdirSync("./logs");
}
if (!fs.existsSync("./backups")){
	fs.mkdirSync("./backups");
}

global.mainConfig = {}
loadConfig("main");
loadModule("modulemanager", true);
ok("Bot has started, ready to connect");
connect(false, 30000);

let ping = function(){
	//info("PINGING");
	if(Connection){
		try{
			Connection.ping();
		}catch(e){
			error(e.message);

		}
	}
	setTimeout(ping, 30000);
};

//ping();

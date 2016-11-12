"use strict";
console.log("Starting the bot");
require('babel/register')({loose: 'all'});
require('sugar');

//Various logging commands for output to the console
let colors = require('colors');

let logToFile = function(text){
	try{
		let now = new Date();
		let filename = "logs/" + now.getUTCFullYear() + "-" + (now.getUTCMonth()+1) + "-" + now.getUTCDate() + ".txt";
		fs.appendFile(filename, "\n[" + new Date().toUTCString() + "]" + text);
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

//Manages most requried node js modules
global.required = {};
global.getRequirement = function(name){
	if(required[name]){
		return required[name];
	}
	try{
		required[name] = require(name);
		return required[name];
	}catch(e){
		error(e.message);
		info("Could not load the requirement " + name);
	}
	return null;
};

let fs = getRequirement("fs");

//Manages config files
global.getConfig = function(name, defaults){
	let toBeLoaded = defaults;
	try{
		let filename = "config/" + name + "_config.json";
		if(fs.existsSync(filename)){
			toBeLoaded = JSON.parse(fs.readFileSync(filename, "utf8"));
		}else{
			let configFile = fs.openSync(filename,"w");
			fs.writeSync(configFile,JSON.stringify(defaults, null, "\t"));
			fs.closeSync(filename);
			info(filename + " did not exists, made it");
		}
	}catch(e){
		error(e.message);
		info("Could not load the config " + name);
	}
	return toBeLoaded;
};
global.loadConfig = function(name, defaults){
	name = normalizeText(name);
	if(name === "main"){
		global.mainConfig = getConfig("main");
		return true;
	}else if(modules[name]){
		let config = getConfig(name, defaults);
		modules[name].config = config;
		return true;
	}
	return false;
}
global.saveConfig = function(name){
	let filename = "config/" + name + "_config.json";
	if(modules[name]&&modules[name].config){
		try{
			let configFile = fs.openSync(filename,"w");
			fs.writeSync(configFile,JSON.stringify(modules[name].config, null, "\t"));
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
	let path = "./bot_modules/" + name + "/" + name;
	try{
		delete require.cache[require.resolve(path)];
		let requiredBy = [];
		let module = modules[name];
		if(module){
			requiredBy = module.requiredBy;
		}else{
			module = {js:null,data:null,requiredBy:[],hooks:{},config:{}};
		}
		modules[name] = module;
		module.hooks = {};
		module.config = getConfig(name, {});
		module.js = require(path);
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
		let path = "./bot_modules/" + name + "/" + name;
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


let request = getRequirement("request");
let WebSocketClient = require('websocket').client;
let Connection = null;

var connect = function (retry) {
    if (retry) {
        info('Retrying...');
    }

    var ws = new WebSocketClient();

    ws.on('connectFailed', function (err) {
        error('Could not connect');
        error(err)
        info('Retrying in thirty seconds');

        setTimeout(function () {
            connect(true);
        }, 30000);
    });

    ws.on('connect', function (con) {
        Connection = con;
        ok('Connected to server');


        con.on('error', function (err) {
            error('Connection error: ' + err.stack);
        });

        con.on('close', function (code, reason) {
            // Is this always error or can this be intended...?
            error('Connection closed: ' + reason + ' (' + code + ')');
            info('Retrying in thirty seconds.');

            setTimeout(function () {
                connect(true);
            }, 30000);
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
    });

    // The connection itself

    info("Connecting to " + mainConfig.connection);
    ws.connect(mainConfig.connection);
};

global.send = function (data) {

	if (!data || !Connection || !Connection.connected) return false;

	/* var now = Date.now();
	if (now < lastSentAt + MESSAGE_THROTTLE - 5) {
		queue.push(data);
		if (!dequeueTimeout) {
			dequeueTimeout = setTimeout(dequeue, now - lastSentAt + MESSAGE_THROTTLE);
		}
		return false;
	} */
	if(mainConfig.log_send){
		dsend(data);
	}
	Connection.send(data);

	/* lastSentAt = now;
	if (dequeueTimeout) {
		if (queue.length) {
			dequeueTimeout = setTimeout(dequeue, MESSAGE_THROTTLE);
		} else {
			dequeueTimeout = null;
		}
	} */
};


function handle(message){
	let chunks = message.split("\n");
    let room = chunks[0].toLowerCase();
    let isInit = false;
    if(chunks[0][0]==">"){
        room = chunks.splice(0,1)[0].substr(1);
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
        		if(module&&module.chathooks){
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

//Removes all non-alphanumeric characters from text, and makes it lower case
global.normalizeText = function(text){
	if(typeof text === "string"){
		return text.toLowerCase().replace(/[^a-z\d]/g,"");
	}
	return "";
};

global.removeRank = function(text){
	if(typeof text === "string"){
		return text.replace(/^[\s!\+%@#&\?]/,"");
	}
	return "";
}

global.toRoomId = function(text){
	if(typeof text === "string"){
		return text.toLowerCase().replace(/[^a-z\d\-]/g,"");
	}
	return "";
}

//Returns whether the two inputs are the same when normalized
global.namesMatch = function(n1, n2){
	return normalizeText(n1) === normalizeText(n2) && typeof n1 === "string" && typeof n2 === "string";
};

loadConfig("main");
loadModule("modulemanager", true);
ok("Bot has started, ready to connect");
connect();

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

ping();

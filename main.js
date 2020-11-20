"use strict";
console.log("Starting the bot");
let fs = require("fs");

let moduleInfo = {};


//Various logging commands for output to the console
let colors = require('colors');
let messageQueue = [];
let lastMessageTime = 0;
let messageTimeout = null;
const MESSAGE_THROTTLE = 700;

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

global.loadConfig2 = function(name, defaults){
	name = toId(name);
	let path = `config/${name}_config.json`;
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
			if(mainConfig.user && !mainConfig.userId){
				mainConfig.userId = toId(mainConfig.user);
				saveConfig(name);
				shouldSave = false;
			}
			if(shouldSave) saveConfig(name);
			if(!mainConfig.user || !mainConfig.pass){
				error("The main config file is missing login information. Please fill it in and re-run the bot.");
				process.exit(0);
			}
		}else{
			modules[name].setConfig(newConfig);
			if(shouldSave) saveConfig(name);
		}
		return true;
	}else{
		//Tried to load config for non-existant module.
		return false;
	}
};

global.saveConfig2 = function(name){
	let filename = "config/" + name + "_config.json";
	if((modules[name] && modules[name].getConfig) || name === "main"){
		try{
			let configFile = fs.openSync(path,"w");
			let config = name === "main" ? mainConfig : modules[name].getConfig();
			fs.writeSync(configFile,JSON.stringify(config, null, "\t"));
			fs.closeSync(configFile);
		}catch(e){
			error(e.message);
			info(`Could not save the config file ${path}`);
		}
	}else{
		info(`Tried to save the config for the non-existant module ${name}`);
	}
};

// NEW  load function
global.loadConfig = function(id, moduleObj){
	if(!moduleObj) return false;

	let path = `config/${id}_config.json`;
	let newConfig = {};
	let shouldSave = false;

	if(fs.existsSync(path)){
		newConfig = JSON.parse(fs.readFileSync(path, "utf8"));
	}

	for(let option in moduleObj.config){
		if(newConfig[option]){
			if(!moduleObj.config[option].parse(newConfig[option])) error(`Failed to load option ${option} for ${id}.`);
		}else{
			newConfig[option] = moduleObj.config[option].value;
			shouldSave = true;
		}
	}

	if(shouldSave) saveConfig(id, newConfig);

	return true;
};
// NEW  save function
global.saveConfig = function(id, configList){
	let path = `config/${id}_config.json`;
	try{
		let configFile = fs.openSync(path,"w");
		fs.writeSync(configFile,JSON.stringify(configList, null, "\t"));
		fs.closeSync(configFile);
	}catch(e){
		error(e.message);
		info(`Could not save the config file ${path}`);
	}
};

//Manages the bot modules
global.modules = {};
global.loadModule2 = function(name, loadData){
	let path = "./bot_modules/" + name;
	try{
		delete require.cache[require.resolve(path)];
		let requiredBy = [];
		let module = modules[name];
		let data;
		if(module){
			requiredBy = module.requiredBy;
			if(loadData && module.onUnload){
				module.onUnload();
			}else if(!loadData && module.getData){
				data = module.getData();
			}
		}
		module = require(path);
		modules[toId(name)] = module;
		loadConfig(name, module.defaultConfigs || {});
		module.onLoad(module, loadData, data);
		module.requiredBy = requiredBy;

		for(let i=0;i<requiredBy.length;i++){
			let requiredByModule = modules[requiredBy[i]];
			if(requiredByModule&&requiredByModule.refreshDependencies){
				requiredByModule.refreshDependencies();
			}
		}
		return true;
	}catch(e){
		error(e.message);
		info(`Could not load the module ${name}`);
	}
	delete modules[name];
	return false;
};
global.unloadModule2 = function(name){
	if(modules[name]){
		let path = `./bot_modules/${name}`;
		delete require.cache[require.resolve(path)];
		let requiredBy = modules[name].requiredBy;
		if(modules[name].onUnload){
			modules[name].onUnload();
		}
		delete modules[name];
		if(requiredBy){
			for(let i=0;i<requiredBy.length;i++){
				let module = modules[requiredBy[i]];
				if(module && module.refreshDependencies){
					module.refreshDependencies();
				}
			}
		}
		return true;
	}
	return false;

};
global.getModuleForDependency2 = function(name, from){
	let module = modules[name];
	if(module){
		if(module.requiredBy.indexOf(from)===-1){
			module.requiredBy.add(from);
		}
	}else{
		modules[name] = {requiredBy:[from]};
	}
	return modules[name];
};

// NEW load function
global.loadModule = function(name, loadData){
	let id = toId(name);
	let path = `./bot_modules/${id}`;
	try{
		delete require.cache[require.resolve(path)];
		let oldModule = modules[id];
		module = require(path);

		if(!moduleInfo[id]){
			moduleInfo[id] = {room: module.Module.room, children: []};
		}else{
			moduleInfo[id].room = module.Module.room;
		}

		let moduleObj = new module.Module();

		for(let i=0;i<moduleObj.dependencies.length;i++){
			let dependency = moduleObj.dependencies[i];
			if(!moduleInfo[dependency]) moduleInfo[dependency] = {children: []};
			if(!moduleInfo[dependency].children.includes(id)) moduleInfo[dependency].children.push(id);
			moduleObj[dependency] = modules[dependency];
		}

		for(let i=0;i<moduleInfo[id].children.length;i++){
			let child = moduleInfo[id].children[i];
			if(modules[child]) modules[child][id] = moduleObj;
		}

		loadConfig(id, moduleObj);

		if(oldModule && loadData){
			oldModule.onUnload();
		}else if(oldModule){
			moduleObj.recover(oldModule);
		}else if(!loadData){
			// no oldModule, but we wanted to use its data
			return false;
		}

		if(loadData){
			moduleObj.onLoad();
			moduleObj.onConnect();
		}

		modules[id] = moduleObj;

		return true;
	}catch(e){
		error(e.message);
		info("Could not load the module " + name);
	}
	delete modules[name];
	return false;
};
// NEW unload function
global.unloadModule = function(name){
	let id = toId(name);
	let path = `./bot_modules/${id}`;

	if(!modules[name]) return false;

	delete require.cache[require.resolve(path)];

	modules[id].onUnload();

	for(let parent in moduleInfo){
		let children = moduleInfo[parent].children;
		let index = children.indexOf(id);
		if(index > -1){
			modules[id][parent] = null;
			children.splice(index, 1);
		}
	}

	let children = moduleInfo[id].children;
	for(let i=0;i<children.length;i++){
		let child = children[i];
		if(modules[child]){
			modules[child][id] = null;
		}
	}

	delete modules[id];
	return true;
};

let stdin = process.openStdin();
stdin.addListener("data", function(d) {
	let text = d.toString().substring(0, d.length-1);
	send(text);
});


let request = require("request");
let WebSocketClient = require("websocket").client;
let Connection = null;

let connect = function (retry, delay) {
	if (retry) {
		info('Retrying...');
	}

	let ws = new WebSocketClient();

	ws.on('connectFailed', function (err) {
		error("Could not connect");
		error(err)
		info(`Retrying in ${delay/1000} seconds`);

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
			error(`Connection error: ${err.stack}`);
			con.drop();
		});

		con.on('close', function (code, reason) {
			// Set Connection to null so everything knows we lost connection
			Connection = null;

			error(`Connection closed: ${reason} (${code})`);
			info(`Retrying in ${(delay/1000)} seconds.`);

			setTimeout(()=>{
				connect(true, delay*2);
			}, delay);
		});

		con.on('message', function (response) {
			try{
				if (response.type !== 'utf8'){
					//info(JSON.stringify(response));
					return false;
				}
				let message = response.utf8Data;
				if(bot.config.log_receive.value){
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

	info(`Connecting to ${bot.config.connection.value}`);
	ws.connect(bot.config.connection.value);
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
			if(bot.config.log_send.value){
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
	let roomName = "";
	let room;
	let isInit = false;
	if(chunks[0][0]==">"){
		roomName = chunks.splice(0,1)[0].substr(1);
	}
	// TODO detect lobby 
	room = RoomManager.getRoom(toRoomId(roomName))
	for(let i=0;i<chunks.length;i++){
		let args = chunks[i].split("|");
		if(args[1]=="challstr"){
			info('challstr')
			request.post(
				{
					url : "http://play.pokemonshowdown.com/action.php",
					formData : {
						act: "login",
						name: bot.config.user.value,
						pass: bot.config.pass.value,
						challengekeyid: args[2],
						challenge: args[3]
					}
				},
				function(err, response, body){
					let data;
					if(!body||body.length < 1){
						body = null;
					}else{
						if(body[0]=="]"){
							body = body.substr(1);
						}
						//info(body);
						data = JSON.parse(body);
					}
					if(data && data.curuser && data.curuser.loggedin){
						send(`|/trn ${bot.config.user.value},0,${data.assertion}`);
					}else{
						// We couldn't log in for some reason
						error("Error logging in...");
						process.exit(1);
					}
			});
		}else if(args[1]=="updateuser"&&toId(args[2].substr(1).split("@")[0])==toId(bot.config.user.value)){
			send("|/avatar 162");
			for(let modulename in modules){
				let module = modules[modulename];
				if(module && module.onConnect){
					// TODO is there a better way to detect when the bot finished logging in?
					module.onConnect();
				}
			}
		}else{
			if(args[1]==="init"){
				isInit = true;
				chunks = chunks.splice(0,4);
				if(!room) room = RoomManager.initRoom(roomName);
			}else if(args[1]==="deinit"){
				isInit = true;
				chunks = chunks.splice(0,4);
				RoomManager.deinitRoom(roomName);
			}else if(args[1]==="users"){
				room.processUsers(args[2].split(",").slice(1));
			}else if(args[1]==="j"||args[1]==="join"||args[1]==="J"){
				let parts = args[2].slice(1).split("@");
				let rank = args[2][0];
				let name = parts[0];
				let status = parts[1];
				let user = room.userJoin(name, toId(name),status, rank);
				for(let modulename in modules){
					let module = modules[modulename];
					try{
						if(module.processJoin) module.processJoin(room, user);
					}catch(e){
						error(e.message);
						info(`Exception when sending join update to ${modulename}`);
					}
				}
			}else if(args[1]==="l"||args[1]==="leave"||args[1]==="L"){
				let id = toId(args[2]);
				let user = room.userLeave(id);
				for(let modulename in modules){
					let module = modules[modulename];
					try{
						if(module.processLeave) module.processLeave(room, user);
					}catch(e){
						error(e.message);
						info(`Exception when sending leave update to ${modulename}`);
					}
				}
			}else if(args[1]==="n"||args[1]==="name"||args[1]==="N"){
				let parts = args[2].slice(1).split("@");
				let rank = args[2][0];
				let name = parts[0];
				let status = parts[1];
				let user = room.userNameChange(name, toId(name), status, rank, args[3]);
				for(let modulename in modules){
					let module = modules[modulename];
					try{
						if(module.processName) module.processName(room, user);
					}catch(e){
						error(e.message);
						info(`Exception when sending name update to ${modulename}`);
					}
				}
			}else if(args[1]==="c"||args[1]==="chat"||args[1]==="c:"||args[1]==="pm"){
				let id, message;
				if(args[1]==="c:"){
					id = toId(args[3]);
					message = args.slice(4,args.length).join("|");
				}else if(args[1]==="pm"){
					id = toId(args[2]);
					message = args.slice(4,args.length).join("|");
				}else{
					id = toId(args[2]);
					message = args.slice(3,args.length).join("|");

				}
				let user = room.getUserData(id);
				if(!user && !room.id){
					user = room.userJoin(args[2].slice(1), toId(args[2]), "", args[2][0]);
				}

				if(!id){
					// This is when some special messages are shown, eg the response to /trivia
					for(let modulename in modules){
						let module = modules[modulename];
						if(module.messagehooks){
							for(let hookname in module.messagehooks){
								try{
									module.messagehooks[hookname].call(module, room, args);
								}catch(e){
									error(e.message);
									info(`Exception while trying message hook from ${modulename} (hook: ${hookname})`);
								}
							}
						}
					}
				} else if(message[0]==="~"){
					let command = message.split(" ")[0].slice(1).toLowerCase();
					let argText = message.substring(command.length+2, message.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}

					//Pass to command listeners
					//We have room object, user object, the command, and the list of arguments
					for(let modulename in modules){
						let module = modules[modulename];
						try{
							if(module.commands && module.commands[command]){
								// info("Running command from " + modulename);
								let commandRoom = RoomManager.getRoom(module.room);
								let commandRank = AuthManager.getRank(user, commandRoom);
								let rank = AuthManager.getRank(user, room);
								let commandFunc = typeof module.commands[command] == "string" ? module.commands[module.commands[command]] : module.commands[command];
								commandFunc.call(module, message, chatArgs, user, rank, room, commandRank, commandRoom);
							}
						}catch(e){
							error(e.message);
							info(`Exception while trying command from ${modulename} (command: ${command})`);
						}
					}
				}else{
					//Pass to chat listeners
					for(let modulename in modules){
						let module = modules[modulename];
						for(let hookname in module.chathooks){
							try{
								module.chathooks[hookname].call(module, room, user, message);
							}catch(e){
								error(e.message);
								info(`Exception while trying chat hook from ${modulename} (hook: ${hookname})`);
							}
						}
					}
				}
				
			}else{
				//Not a chat message, so it goes to the message hooks
				for(let modulename in modules){
					let module = modules[modulename];
					if(module.messagehooks){
						for(let hookname in module.messagehooks){
							try{
								module.messagehooks[hookname].call(module, room, args);
							}catch(e){
								error(e.message);
								info(`Exception while trying message hook from ${modulename} (hook: ${hookname})`);
							}
						}
					}
				}
			}
		}
	}
}

//Here are some useful functions for all modules to use

// TODO is this still needed?
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

global.MD5 = function(f){function i(b,c){var d,e,f,g,h;f=b&2147483648;g=c&2147483648;d=b&1073741824;e=c&1073741824;h=(b&1073741823)+(c&1073741823);return d&e?h^2147483648^f^g:d|e?h&1073741824?h^3221225472^f^g:h^1073741824^f^g:h^f^g}function j(b,c,d,e,f,g,h){b=i(b,i(i(c&d|~c&e,f),h));return i(b<<g|b>>>32-g,c)}function k(b,c,d,e,f,g,h){b=i(b,i(i(c&e|d&~e,f),h));return i(b<<g|b>>>32-g,c)}function l(b,c,e,d,f,g,h){b=i(b,i(i(c^e^d,f),h));return i(b<<g|b>>>32-g,c)}function m(b,c,e,d,f,g,h){b=i(b,i(i(e^(c|~d),
	f),h));return i(b<<g|b>>>32-g,c)}function n(b){var c="",e="",d;for(d=0;d<=3;d++)e=b>>>d*8&255,e="0"+e.toString(16),c+=e.substr(e.length-2,2);return c}var g=[],o,p,q,r,b,c,d,e,f=function(b){for(var b=b.replace(/\r\n/g,"\n"),c="",e=0;e<b.length;e++){var d=b.charCodeAt(e);d<128?c+=String.fromCharCode(d):(d>127&&d<2048?c+=String.fromCharCode(d>>6|192):(c+=String.fromCharCode(d>>12|224),c+=String.fromCharCode(d>>6&63|128)),c+=String.fromCharCode(d&63|128))}return c}(f),g=function(b){var c,d=b.length;c=
	d+8;for(var e=((c-c%64)/64+1)*16,f=Array(e-1),g=0,h=0;h<d;)c=(h-h%4)/4,g=h%4*8,f[c]|=b.charCodeAt(h)<<g,h++;f[(h-h%4)/4]|=128<<h%4*8;f[e-2]=d<<3;f[e-1]=d>>>29;return f}(f);b=1732584193;c=4023233417;d=2562383102;e=271733878;for(f=0;f<g.length;f+=16)o=b,p=c,q=d,r=e,b=j(b,c,d,e,g[f+0],7,3614090360),e=j(e,b,c,d,g[f+1],12,3905402710),d=j(d,e,b,c,g[f+2],17,606105819),c=j(c,d,e,b,g[f+3],22,3250441966),b=j(b,c,d,e,g[f+4],7,4118548399),e=j(e,b,c,d,g[f+5],12,1200080426),d=j(d,e,b,c,g[f+6],17,2821735955),c=
	j(c,d,e,b,g[f+7],22,4249261313),b=j(b,c,d,e,g[f+8],7,1770035416),e=j(e,b,c,d,g[f+9],12,2336552879),d=j(d,e,b,c,g[f+10],17,4294925233),c=j(c,d,e,b,g[f+11],22,2304563134),b=j(b,c,d,e,g[f+12],7,1804603682),e=j(e,b,c,d,g[f+13],12,4254626195),d=j(d,e,b,c,g[f+14],17,2792965006),c=j(c,d,e,b,g[f+15],22,1236535329),b=k(b,c,d,e,g[f+1],5,4129170786),e=k(e,b,c,d,g[f+6],9,3225465664),d=k(d,e,b,c,g[f+11],14,643717713),c=k(c,d,e,b,g[f+0],20,3921069994),b=k(b,c,d,e,g[f+5],5,3593408605),e=k(e,b,c,d,g[f+10],9,38016083),
	d=k(d,e,b,c,g[f+15],14,3634488961),c=k(c,d,e,b,g[f+4],20,3889429448),b=k(b,c,d,e,g[f+9],5,568446438),e=k(e,b,c,d,g[f+14],9,3275163606),d=k(d,e,b,c,g[f+3],14,4107603335),c=k(c,d,e,b,g[f+8],20,1163531501),b=k(b,c,d,e,g[f+13],5,2850285829),e=k(e,b,c,d,g[f+2],9,4243563512),d=k(d,e,b,c,g[f+7],14,1735328473),c=k(c,d,e,b,g[f+12],20,2368359562),b=l(b,c,d,e,g[f+5],4,4294588738),e=l(e,b,c,d,g[f+8],11,2272392833),d=l(d,e,b,c,g[f+11],16,1839030562),c=l(c,d,e,b,g[f+14],23,4259657740),b=l(b,c,d,e,g[f+1],4,2763975236),
	e=l(e,b,c,d,g[f+4],11,1272893353),d=l(d,e,b,c,g[f+7],16,4139469664),c=l(c,d,e,b,g[f+10],23,3200236656),b=l(b,c,d,e,g[f+13],4,681279174),e=l(e,b,c,d,g[f+0],11,3936430074),d=l(d,e,b,c,g[f+3],16,3572445317),c=l(c,d,e,b,g[f+6],23,76029189),b=l(b,c,d,e,g[f+9],4,3654602809),e=l(e,b,c,d,g[f+12],11,3873151461),d=l(d,e,b,c,g[f+15],16,530742520),c=l(c,d,e,b,g[f+2],23,3299628645),b=m(b,c,d,e,g[f+0],6,4096336452),e=m(e,b,c,d,g[f+7],10,1126891415),d=m(d,e,b,c,g[f+14],15,2878612391),c=m(c,d,e,b,g[f+5],21,4237533241),
	b=m(b,c,d,e,g[f+12],6,1700485571),e=m(e,b,c,d,g[f+3],10,2399980690),d=m(d,e,b,c,g[f+10],15,4293915773),c=m(c,d,e,b,g[f+1],21,2240044497),b=m(b,c,d,e,g[f+8],6,1873313359),e=m(e,b,c,d,g[f+15],10,4264355552),d=m(d,e,b,c,g[f+6],15,2734768916),c=m(c,d,e,b,g[f+13],21,1309151649),b=m(b,c,d,e,g[f+4],6,4149444226),e=m(e,b,c,d,g[f+11],10,3174756917),d=m(d,e,b,c,g[f+2],15,718787259),c=m(c,d,e,b,g[f+9],21,3951481745),b=i(b,o),c=i(c,p),d=i(d,q),e=i(e,r);return(n(b)+n(c)+n(d)+n(e)).toLowerCase()};

//Saves text to somewhere accessible via the internet, and returns the link used to access it.
//onSuccess takes one argument (the link to the text), and onError takes one argument (the string failure reason)
// TODO make this have just one callback
global.uploadText = function(text, onSuccess, onError){
	let filename = `${MD5(text.substr(0,10)+Date.now())}.txt`;
	try{
		let textFile = fs.openSync(bot.config.text_directory.value + filename,"w");
		fs.writeSync(textFile,text,null,'utf8');
		fs.closeSync(textFile);
		if(onSuccess) onSuccess(bot.config.text_web_directory.value + filename);
	}catch(e){
		error(e.message);
		if(onError) onError("Could not save the text file.");
	}
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

let bm = require('./basemodule');
loadModule('bot', true);
global.bot = modules['bot'];
if(!bot.config.user.value || !bot.config.userId.value || !bot.config.pass.value){
	error("The main config file is missing login information. Please fill it in and re-run the bot.");
	process.exit(0);
}

let rm = require('./roommanager');
global.RoomManager = new rm.RoomManager();
RoomManager.initRoom("");

let am = require('./authmanager');
global.AuthManager = new am.AuthManager();
AuthManager.loadAuth("data/authlist.json");


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

"use strict";
console.log("Starting the bot");
let fs = require("fs");
const axios = require('axios');
let helpers = require('./helperfuncs');

global.moduleInfo = {};


//Various logging commands for output to the console
let colors = require('colors');
let messageQueue = [];
let lastMessageTime = 0;
let messageTimeout = null;
const MESSAGE_THROTTLE = 700;

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


async function handle(message){
	let chunks = message.split("\n");
	let roomName = "";
	let room;
	let isInit = false;
	if(chunks[0][0]==">"){
		roomName = chunks.splice(0,1)[0].substr(1);
	}
	room = RoomManager.getRoom(toRoomId(roomName))
	for(let i=0;i<chunks.length;i++){
		let args = chunks[i].split("|");
		if(!roomName && args[1] !== 'pm'){
			room = RoomManager.getRoom('lobby');
			roomName = 'lobby';
		}
		if(args[1]=="challstr"){
			info('challstr')
			try{
				info('making axios request')
			const {data} = await axios.post('https://play.pokemonshowdown.com/api/login', {act: "login", name: bot.config.user.value, pass:bot.config.pass.value, challstr: `${args[2]}|${args[3]}`}, {
				  headers: {
					      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
					    }
			})
				try{
				info('finished axios request');
				info(JSON.stringify(data));
				info(data.substr(1));
				info('about to parse data');
				let dataobj = JSON.parse(data.substr(1));
				if(dataobj && dataobj.curuser && dataobj.curuser.loggedin){
					info('sending trn');
					bot.assertion = dataobj.assertion;
					send(`|/trn ${bot.config.user.value},0,${dataobj.assertion}`);
				}else{
					// We couldn't log in for some reason
					error("Error logging in...");
					process.exit(1);
				}
				}catch(err){
					info(err)
				}
			info('end of axios post');
			}catch(err){
				info('axios request error');
				info(JSON.stringify(err));
			}
			//request.post(
				//{
					//url : "https://play.pokemonshowdown.com/api/login",
					//formData : {
						//act: "login",
						//name: bot.config.user.value,
						//pass: bot.config.pass.value,
						//challstr: `${args[2]}|${args[3]}`,
						//challengekeyid: args[2],
						//challenge: args[3]
					//}
				//},
				//function(err, response, body){
					//let data;
					//if(!body||body.length < 1){
						//body = null;
					//}else{
						//if(body[0]=="]"){
							//body = body.substr(1);
						//}
						//info(body);
						//data = JSON.parse(body);
					//}
					//if(data && data.curuser && data.curuser.loggedin){
						//bot.assertion = data.assertion;
						//send(`|/trn ${bot.config.user.value},0,${data.assertion}`);
					//}else{
						//// We couldn't log in for some reason
						//error("Error logging in...");
						//process.exit(1);
					//}
			//});
		}else if(args[1]=="updateuser"&&toId(args[2].substr(1).split("@")[0])==toId(bot.config.user.value)){
			send(`|/avatar ${bot.config.avatar.value}`);
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
			}else if(args[1]==="popup"){
				RoomManager.handlePopup(args.slice(2).join('|'));
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
			}else if(args[1] === 'hidelines'){
				let user = room.getUserData(args[3]);
				if(user){
					for(let modulename in modules){
						let module = modules[modulename];
						try{
							if(module.processHide) module.processHide(room, user);
						}catch(e){
							error(e.message);
							info(`Exception when sending hide update to ${modulename}`);
						}
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

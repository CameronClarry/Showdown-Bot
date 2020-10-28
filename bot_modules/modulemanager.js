let fs = require("fs");
let request = require("request");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;
let ranks = [" ", "+", "%", "@", "*", "&", "#", "~"];

const GOVERNING_ROOM = "";
exports.GOVERNING_ROOM = GOVERNING_ROOM;

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(loadData){
		data = {modulesToLoad: []};
		loadModuleList();
		loadAllModules();
	}

};
exports.onUnload = function(){

};


let refreshDependencies = function(){
}; 
exports.refreshDependencies = refreshDependencies;
exports.onConnect = function(){

};
exports.getData = function(){
	return data;
}
exports.getConfig = function(){
	return config;
}
exports.setConfig = function(newConfig){
	config = newConfig;
}

let commands = {
	load: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to load modules.", rank);
		}else if(!args.length){
			room.broadcast(user, "You must specify the module to be loaded.", rank);
		}else{
			room.broadcast(user, managerFuncs.load(args[0]), rank);
		}
	},
	reload: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to load modules.", rank);
		}else if(!args.length){
			room.broadcast(user, "You must specify the module to reload.", rank);
		}else{
			room.broadcast(user, managerFuncs.reload(args[0]), rank);
		}
	},
	unload: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to unload modules.", rank);
		}else if(!args.length){
			room.broadcast(user, "You must specify the module to be unloaded.", rank);
		}else{
			room.broadcast(user, managerFuncs.unload(args[0]), rank);
		}
	},
	config: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to manage configs.", rank);
		}else if(args.length < 2){
			room.broadcast(user, "You must give a config command and a module name.", rank);
		}else{
			let command = args[0].toLowerCase();
			if(configFuncs[command]){
				configFuncs[command](message, args, user, rank, room, commandRank, commandRoom);
			}else{
				room.broadcast(user, "That config command was unrecognized.", rank);
			}
		}
	}
};

self.commands = commands;
exports.commands = commands;

let managerFuncs = {
	load: function(name){
		let moduleName = toId(name);
		let result = loadModule(moduleName,true);
		let response = "Something is wrong if you see this.";
		if(result && moduleName !== "modulemanager"){
			if(data.modulesToLoad.indexOf(moduleName) === -1){
				data.modulesToLoad.add(moduleName);
				saveModuleList();
				response = `Successfully loaded the module ${name}.`;
			}else{
				response = `Successfully reloaded the module ${name} and its data.`;
			}
		}else if(result){
			response = "Successfully loaded the module manager.";
		}else{
			response = `Could not load the module ${name}.`;
		}
		return response;
	},
	reload: function(name){
		let moduleName = toId(name);
		let response = `Could not reload the module ${name}.`;
		if(!modules[moduleName] || (data.modulesToLoad.indexOf(moduleName) === -1 && moduleName !== "modulemanager")){
			response = managerFuncs.load(moduleName);
		}else{
			let result = loadModule(moduleName,false);
			if(result && moduleName !== "modulemanager"){
				response = `Successfully reloaded the module ${name}.`;
			}else if(result){
				response = "Successfully reloaded the module manager.";
			}
		}
		return response;
	},
	unload: function(name){
		let moduleName = toId(name);
		let result = unloadModule(moduleName);
		let response = `Could not unload the module ${name}.`;
		if(result){
			response = "Successfully unloaded the module " + name + ".";
			let index = data.modulesToLoad.indexOf(moduleName);
			// info(data.modulesToLoad);
			// info(moduleName);
			// info(index);
			if(index !== -1){
				data.modulesToLoad.splice(index,1);
				saveModuleList();
			}
		}
		return response;
	},
	config: function(name){
		let result = loadConfig(name);
		let response = `Could not reload the config for ${name}.`;
		if(result){
			response = `Successfully reloaded the config for ${name}.`;
		}
		return response;
	}
}

let configFuncs = {
	reload: function(message, args, user, rank, room, commandRank, commandRoom){
		let name = toId(args[0]);
		if(name){
			room.broadcast(user, managerFuncs.config(name), rank);
		}else{
			room.broadcast(user, "You need to give a proper module name.", rank);
		}
	},
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		let name = toId(args[1]);
		if(name){
			// info(name);
			let module = modules[name];
			if(module){
				let configs = [];
				let moduleConfigs = module.getConfig();
				for(let config in moduleConfigs){
					configs.push(`${config}: ${moduleConfigs[config]}`);
				}
				uploadText(configs.join("\n"), (address)=>{
					room.broadcast(user, address, rank);
				}, (error)=>{
					room.broadcast(user, "There was an error while saving the file.", rank);
				});
			}else{
				room.broadcast(user, "That module does not exist.", rank);
			}
		}else{
			room.broadcast(user, "You need to give a proper module name.", rank);
		}
	},
	set: function(message, args, user, rank, room, commandRank, commandRoom){
		let name = toId(args[0]);
		if(args.length<3){
			room.broadcast(user, "You must give the module, the property, and the value.", rank);
		}else if(name && modules[name]){
			let module = modules[name];
			let property = args[1];
			let moduleConfigs = module.getConfig();
			if(moduleConfigs[property]){
				let value = getProperty(args[2], module.configTypes[property]);
				if(value){
					moduleConfigs[property] = value;
					saveConfig(name);
					room.broadcast(user, `Successfully set the ${property} property of ${name} to ${value}.`, rank);
				}else{
					room.broadcast(user, "You must give a proper value for that property.", rank);
				}
			}else{
				room.broadcast(user, "The property you gave does not exist.", rank);
			}
		}else{
			room.broadcast(user, "That module does not exist.", rank);
		}
	},
	update: function(message, args, user, rank, room, commandRank, commandRoom){
		let name = toId(args[0]);
		if(args.length<2){
			room.broadcast(user, "You must give the module, and a link to a hastebin raw paste.", rank);
		}else if(!name || !modules[name]){
			room.broadcast(user, `The module '${name}' does not exist.`, rank);
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[1])){
			let module = modules[name];
			let response = "Finished updating the configs.";
			request.get(args[1],function(err, response2, body){
				if(err){
						error(err);
						room.broadcast(user, err, rank);
						return;
				}
				let configs = body.split("\n");
				let moduleConfigs = module.getConfig();
				for(let i=0;i<configs.length;i++){
					let config = configs[i].split(":");
					let property = config[0];
					if(moduleConfigs[property]){
						let value = getProperty(config[1].trim(), module.configTypes[property]);
						if(value){
							moduleConfigs[property] = value;
						}else{
							response = "Invalid value given for " + property + ".";
							response = `Invalid value given for ${property}.`;
							info(module.configTypes[property])
							info(config[1]);
							info(value);
							error(response);
						}
					}else{
						response = `The property ${property} doesn't exist.`;
						error(response);
					}
				}
				saveConfig(name);
				room.broadcast(user, response, rank);
			});
		}else{
			room.broadcast(user, "There was something wrong with your link, make sure it's only the raw paste.", rank);
		}
	}
};

let loadModuleList = function(){
		try{
			let filename = "data/modules.json";
			if(fs.existsSync(filename)){
				data.modulesToLoad = JSON.parse(fs.readFileSync(filename, "utf8"));
				ok("Successfully loaded the module list.");
			}else{
				data.modulesToLoad = [];
				let moduleFile = fs.openSync(filename,"w");
				fs.writeSync(moduleFile,JSON.stringify(data.modulesToLoad, null, "\t"));
				fs.closeSync(moduleFile);
				error("No module list found, saved a new one.")
			}
		}catch(e){
			error(e.message);
			error("Could not load the module list.")
		}
};

let saveModuleList = function(){
	try{
		let filename = "data/modules.json";
		let moduleFile = fs.openSync(filename,"w");
		fs.writeSync(moduleFile,JSON.stringify(data.modulesToLoad, null, "\t"));
		fs.closeSync(moduleFile);
		ok("Saved the module list.");
	}catch(e){
		error(e.message);
		error("Could not save the module list.");
	}
};

let loadAllModules = function(){
	for(let i=0;i<data.modulesToLoad.length;i++){
		let moduleName = data.modulesToLoad[i];
		let result = loadModule(moduleName, true);
		if(!result){
			data.modulesToLoad.splice(i,1);
			i--;
			error(`Could not load the module '${moduleName}'.`);
			continue;
		}
		ok(`Loaded the module '${moduleName}'.`);
	}
};

let getProperty = function(valueStr, type){
	if(type === "string"){
		return valueStr;
	}else if(type === "int"){
		return /^[0-9]+$/.test(valueStr) ? parseInt(valueStr) : null;
	}else if(type === "rank"){
		if(ranks.indexOf(valueStr) !== -1){
			return valueStr;
		}else if(!valueStr){
			return " ";
		}else{
			return null;
		}
	}else{
		return null;
	}
}

let defaultConfigs = {
	loadModuleRank: "#"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	loadModuleRank: "rank"
};

exports.configTypes = configTypes;

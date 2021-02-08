let fs = require("fs");
let request = require("request");

let moduleRoomRank = function(user, moduleId){
	let moduleRoomId = moduleInfo[moduleId] && moduleInfo[moduleId].room;
	return AuthManager.getRank(user, RoomManager.getRoom(moduleRoomId));
}

let commands = {
	load: function(message, args, user, rank, room, commandRank, commandRoom){
		let moduleId = toId(args[0]);
		commandRank = moduleRoomRank(user, moduleId)
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to load that module.", rank);
		}else if(!args.length){
			room.broadcast(user, "You must specify the module to be loaded.", rank);
		}else{
			room.broadcast(user, this.loadModule.call(this, moduleId), rank);
		}
	},
	reload: function(message, args, user, rank, room, commandRank, commandRoom){
		let moduleId = toId(args[0]);
		commandRank = moduleRoomRank(user, moduleId)
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to load that module.", rank);
		}else if(!args.length){
			room.broadcast(user, "You must specify the module to reload.", rank);
		}else{
			room.broadcast(user, this.reloadModule.call(this, moduleId), rank);
		}
	},
	unload: function(message, args, user, rank, room, commandRank, commandRoom){
		let moduleId = toId(args[0]);
		commandRank = moduleRoomRank(user, moduleId)
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to unload that module.", rank);
		}else if(!args.length){
			room.broadcast(user, "You must specify the module to be unloaded.", rank);
		}else{
			room.broadcast(user, this.unloadModule.call(this,moduleId), rank);
		}
	},
	config: function(message, args, user, rank, room, commandRank, commandRoom){
		let moduleId = toId(args[0]);
		commandRank = moduleRoomRank(user, moduleId)
		if(!AuthManager.rankgeq(commandRank,"#")){
			room.broadcast(user, "Your rank is not high enough to manage that config.", rank);
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

let managerFuncs = {
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
				uploadText(configs.join("\n"), (err, address)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}
					room.broadcast(user, address, rank);
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

class ModuleManager extends BaseModule{
	constructor(){
		super();
		this.room = ModuleManager.room;
		this.config = {
			loadModuleRank: new ConfigRank("#")
		};
		this.commands = commands;
	}

	onLoad(){
		this.loadModuleList();
		this.loadAllModules();
	}

	loadModuleList(){
		try{
			let path = "data/modules.json";
			if(fs.existsSync(path)){
				this.modulesToLoad = JSON.parse(fs.readFileSync(path, "utf8"));
				ok("Successfully loaded the module list.");
			}else{
				this.modulesToLoad = [];
				error("No module list found, saving a new one.");
				this.saveModuleList();
			}
		}catch(e){
			error(e.message);
			error("Could not load the module list.");
			this.modulesToLoad = [];
		}
	}

	saveModuleList(){
		try{
			let filename = "data/modules.json";
			let moduleFile = fs.openSync(filename,"w");
			fs.writeSync(moduleFile,JSON.stringify(this.modulesToLoad, null, "\t"));
			fs.closeSync(moduleFile);
			ok("Saved the module list.");
		}catch(e){
			error(e.message);
			error("Could not save the module list.");
		}
	}

	loadAllModules(){
		for(let i=0;i<this.modulesToLoad.length;i++){
			let moduleName = this.modulesToLoad[i];
			let result = loadModule(moduleName, true);
			if(!result){
				this.modulesToLoad.splice(i,1);
				i--;
				error(`Could not load the module '${moduleName}'.`);
				continue;
			}
			ok(`Loaded the module '${moduleName}'.`);
		}
	}

	loadModule(id){
		let result = loadModule(id, true);
		if(result && id !== "modulemanager"){
			if(this.modulesToLoad.indexOf(id) === -1){
				this.modulesToLoad.push(id);
				this.saveModuleList();
				return "Successfully loaded the module " + id + ".";
			}else{
				return `Successfully reloaded the module ${id} and its data.`;
			}
		}else if(result){
			return "Successfully loaded the module manager.";
		}

		return `Could not load the module ${id}.`;
	}

	reloadModule(id){
		if(!modules[id] || (this.modulesToLoad.indexOf(id) === -1 && id !== "modulemanager")){
			return this.loadModule(id);
		}else{
			let result = loadModule(id,false);
			if(result && id !== "modulemanager"){
				return `Successfully reloaded the module ${id}.`;
			}else if(result){
				return "Successfully reloaded the module manager.";
			}
		}
		return `Could not reload the module ${id}.`
	}

	unloadModule(id){
		let result = unloadModule(id);
		if(result){
			let index = this.modulesToLoad.indexOf(id);
			if(index !== -1){
				this.modulesToLoad.splice(index,1);
				this.saveModuleList();
			}
			return `Successfully unloaded the module ${id}.`;
		}
		return `Could not unload the module ${id}.`;
	}

	recover(oldModule){
		this.modulesToLoad = oldModule.modulesToLoad;
	}
}

exports.Module = ModuleManager;

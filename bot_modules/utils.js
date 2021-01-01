let commands = {
	color: "colour",
	colour: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, hashColour(toId(args[0])), rank);
	},
	restart: function(message, args, user, rank, room, commandRank, commandRoom){
		if(user.id === toId(bot.config.owner.value)){
			if(!this.askToRestart){
				room.broadcast(user, "WARNING: All this really does is crash the bot and let the system restart the program if it is set up to do so. This should only be used when the main file must be reloaded, and there is a system in place to restart the bot. Use the command again to confirm.", rank);
				this.askToRestart = true;
			}else{
				room.broadcast(user, "Restarting (crashing)...", rank);
				setTimeout(()=>{
					callNonexistantFunction();
				},100);
			}
		}
	}
};

class Utils extends BaseModule{
	constructor(){
		super();
		this.room = Utils.room;
		this.config = {
			room: new ConfigString('')
		};
		this.commands = commands;
		this.askToRestart = null;
	}

	recover(oldModule){
		this.askToRestart = oldModule.askToRestart;
	}


}

exports.Module = Utils;

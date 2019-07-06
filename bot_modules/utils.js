let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat;
let auth;
const ROOM = "";

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {
			askToRestart: null
		};
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js){
						let rank = auth.js.getEffectiveRoomRank(m, "ou");
						let commandToRun = commands[command];
						if(typeof commandToRun === "string"){
							commandToRun = commands[commandToRun];
						}
						commandToRun(m, chatArgs, rank);
					}
				}
			}
		}
	};
};

exports.onUnload = function(){

};

exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "utils");
	auth = getModuleForDependency("auth", "utils");
};

exports.onConnect = function(){

};

let commands = {
	color: "colour",
	colour: function(message, args, rank){
		chat.js.reply(message, hashColour(toId(args[0])));
	},
	restart: function(message, args, rank){
		if(idsMatch(message.user, mainConfig.owner) && mainConfig.owner){
			if(!self.data.askToRestart){
				chat.js.reply(message, "WARNING: All this really does is crash the bot and let the system restart the program if it is set up to do so. This should only be used when the main file must be reloaded, and there is a system in place to restart the bot. Use the command again to confirm.");
				self.data.askToRestart = true;
			}else{
				chat.js.reply(message, "Restarting (crashing)...");
				setTimeout(()=>{
					callNonexistantFunction();
				},100);
			}
		}
	}
};

// MD5 and hashColour taken from PS code

let hashColour = function(name) {
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

// hslToHex from https://stackoverflow.com/a/44134328

let hslToHex = function(h, s, l) {
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

let defaultConfigs = {
	room: ""
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	room: "string"
};

exports.configTypes = configTypes;

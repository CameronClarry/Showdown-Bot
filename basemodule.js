class BaseModule{

	constructor(){
		this.dependencies = [];
	}

	onJoin(room, user){

	}

	onLeave(room, user){

	}

	onName(room, user, oldId){

	}

	onConnect(){

	}

	onLoad(){

	}

	onUnload(){

	}

	onChat(){

	}

	onCommand(){

	}

	recover(oldModule){

	}
}
global.BaseModule = BaseModule
BaseModule.room = '';

class ConfigOption{
	constructor(value){
		this.value = value;
	}

	parse(value){
		this.value = value;
		return true;
	}

	toString(){
		return this.value.toString();
	}
}
global.ConfigOption = ConfigOption

class ConfigRank extends ConfigOption{
	constructor(value){
		super(value);
	}

	parse(value){
		if(AuthManager.isRank(value)){
			this.value = value;
			return true;
		}
		return false;
	}
}
global.ConfigRank = ConfigRank

class ConfigInt extends ConfigOption{
	constructor(value){
		super(value);
	}

	parse(value){
		if(/^[0-9]+$/.test(value)){
			this.value = parseInt(value);
			return true;
		}
		return false;
	}
}
global.ConfigInt = ConfigInt

class ConfigString extends ConfigOption{
	constructor(value){
		super(value);
	}

	parse(value){
		this.value = value.toString();
		return true;
	}
}
global.ConfigString = ConfigString

class ConfigBoolean extends ConfigOption{
	constructor(value){
		super(value);
	}

	parse(value){
		if(typeof(value) === 'boolean'){
			this.value = value;
			return true;
		}else if(value === 'true'){
			this.value = true;
			return true;
		}else if(value === 'false'){
			this.value = false;
			return true;
		}
		return false;
	}
}
global.ConfigBoolean = ConfigBoolean

class ConfigArray extends ConfigOption{
	constructor(value){
		super(value);
	}

	parse(value){
		if(Array.isArray(value)){
			this.value = value;
			return true;
		}
		return false;
	}
}
global.ConfigArray = ConfigArray

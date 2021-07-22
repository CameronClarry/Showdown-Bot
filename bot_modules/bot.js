class Bot extends BaseModule{
	constructor(){
		super();
		this.config = {
			"user": new ConfigString(""),
			"userId": new ConfigString(""),
			"pass": new ConfigString(""),
			"owner": new ConfigString(""),
			"connection": new ConfigString("ws://sim.smogon.com/showdown/websocket"),
			"log_receive": new ConfigBoolean(true),
			"log_send": new ConfigBoolean(true),
			"dbuser": new ConfigString(""),
			"dbpassword": new ConfigString(""),
			"dbhost": new ConfigString(""),
			"dbport": new ConfigInt(0),
			"dbname": new ConfigString(""),
			"text_directory": new ConfigString("./"),
			"text_web_directory": new ConfigString("www.example.com"),
			"discordStaffWebhook": new ConfigString(""),
			"noStaffRooms": new ConfigArray([])
		};
	}
}

exports.Module = Bot

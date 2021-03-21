import ChatMessage from "terrariaserver-lite/chatmessage";
import Client from "terrariaserver-lite/client";
import ChatPacketFactory from "terrariaserver-lite/packets/chatfactory";
import TerrariaServer from "terrariaserver-lite/terrariaserver";
import Extension from "terrariaserver-lite/extensions/extension";
import { config } from "./configloader";
import RabbitMQ from "./rabbitmq";

interface PhaseMessage {
    token: string;
    type: string;
}

interface PhaseChatMessage extends PhaseMessage {
    content: string;
    contentRaw: { plain: string, formatted: string };
    chatType: string;
    originServer: string;
    prefix: string | null;
    suffix: string | null;
    R: number;
    G: number;
    B: number;
    ip: string;
    discussionId: number;
    userId: number;
    name: string;
    accountName: string;
}

interface GenericPhaseCommandMessage extends PhaseMessage {
    commandName: string;
    sender: string;
    discID: number;
    commandUserName: string;
}

interface GenericPhaseKickCommandMessage extends GenericPhaseCommandMessage {
    commandName: "kick";
    kickType: string;
    reason: string;
}

interface PhaseKickPlayerCommandMessage extends GenericPhaseKickCommandMessage {
    kickType: "playerName";
    playerName: string
}

interface PhaseKickAccountCommandMessage extends GenericPhaseKickCommandMessage {
    kickType: "accountName";
    accountName: string
}

type PhaseKickCommandMessage = PhaseKickPlayerCommandMessage | PhaseKickAccountCommandMessage;

interface GenericPhaseMuteCommandMessage extends GenericPhaseCommandMessage {
    commandName: "mute";
    muteType: string;
    reason: string;
    remove: boolean;
}

interface PhaseMutePlayerCommandMessage extends GenericPhaseMuteCommandMessage {
    muteType: "playerName";
    playerName: string
}

interface PhaseMuteAccountCommandMessage extends GenericPhaseMuteCommandMessage {
    muteType: "accountName";
    accountName: string
}

type PhaseMuteCommandMessage = PhaseMutePlayerCommandMessage | PhaseMuteAccountCommandMessage;

interface GenericPhaseBanCommandMessage extends GenericPhaseCommandMessage {
    commandName: "ban";
    banType: string;
    reason: string;
    remove: boolean;
    offline: boolean;
}

interface PhaseBanPlayerCommandMessage extends GenericPhaseBanCommandMessage {
    banType: "playerName";
    playerName: string;
}

interface PhaseBanAccountCommandMessage extends GenericPhaseBanCommandMessage {
    banType: "accountName";
    accountName: string;
}

interface PhaseBanIpCommandMessage extends GenericPhaseBanCommandMessage {
    banType: "playerIP";
    playerName: string;
    playerIP: string;
}

type PhaseBanCommandMessage = PhaseBanPlayerCommandMessage | PhaseBanAccountCommandMessage | PhaseBanIpCommandMessage;

type PhaseCommandMessage = PhaseKickCommandMessage | PhaseBanCommandMessage | PhaseMuteCommandMessage;

interface GenericPhaseCommandResponse {
    type: "commandResponse";
    sender: string;
    discID: number;
}

interface PhaseCommandSuccessResponse extends GenericPhaseCommandResponse {
    state: "success";
    responseMessage: string;
}

interface PhaseCommandFailureResponse extends GenericPhaseCommandResponse {
    state: "failure";
    responseMessage: string;
}

type PhaseCommandResponse = PhaseCommandSuccessResponse | PhaseCommandFailureResponse;

function makeSuccessResponse(commandMessage: PhaseCommandMessage, response: string): PhaseCommandSuccessResponse {
    return {
        type: "commandResponse",
        sender: commandMessage.sender,
        discID: commandMessage.discID,
        state: "success",
        responseMessage: response,
    };
}

function makeFailureResponse(commandMessage: PhaseCommandMessage, response: string): PhaseCommandFailureResponse {
    return {
        type: "commandResponse",
        sender: commandMessage.sender,
        discID: commandMessage.discID,
        state: "failure",
        responseMessage: response,
    };
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(() => resolve(), ms));
}

class Phase extends Extension {
    public name = "Phase";
    public version = "v1.0";
    public static order = 2;
    private _rabbit: RabbitMQ;

    constructor(server: TerrariaServer) {
        super(server);
        this._rabbit = new RabbitMQ(server.logger);
        this._rabbit.on("connected", () => this.onConnect());
        this.doConnect();
    }

    private async doConnect() {
        while (true) {
            try {
                await this.connect();
                return;
            } catch(e) {
                console.log(e);
                await wait(5000);
            }
        }
    }

    private onConnect() {
        this._rabbit.subscribe(config.subExchangeName, (message: PhaseMessage) => {
            this.handlePhaseMessage(message);
        });

        this._rabbit.publish("phase_in", JSON.stringify({
            token: config.token,
            type: "started"
        }));
    }

    public dispose(): void {
        this.server.logger.info("Disposing Phase Extension. \n"+(new Error("Disposed at").stack))
        super.dispose();
        if (this._rabbit) {
            this._rabbit.close();
        }
    }

    private async connect(): Promise<void> {
        await this._rabbit.connect();
    }

    private handlePhaseMessage(message: PhaseMessage): void {
        if (message.token !== config.token) {
            return;
        }

        if (message.type === "chat") {
            const chatMessage = message as PhaseChatMessage;
            let packet: Buffer;
            if (chatMessage.prefix === null) {
                packet = ChatPacketFactory.make(
                    `${chatMessage.originServer}> <${chatMessage.name}> ${chatMessage.suffix || ""}: ${chatMessage.contentRaw.plain}`, {
                    R: chatMessage.R,
                    G: chatMessage.G,
                    B: chatMessage.B
                });
            } else {
                packet = ChatPacketFactory.make(
                    `${chatMessage.originServer}> [${chatMessage.prefix}] <${chatMessage.name}> ${chatMessage.suffix || ""}: ${chatMessage.contentRaw.plain}`, {
                        R: chatMessage.R,
                        G: chatMessage.G,
                        B: chatMessage.B
                    });
            }

            for (const client of this.server.clients) {
                client.sendPacket(packet);
            }
        } else if (message.type === "command") {
            this.handlePhaseCommand(message as PhaseCommandMessage);
        }
    }

    private async handlePhaseCommand(commandMessage: PhaseCommandMessage) {
        let response: PhaseCommandResponse = makeFailureResponse(commandMessage, "Could not determine command");
        switch (commandMessage.commandName) {
            case "kick": {
                    let client: Client | undefined = undefined;
                    let name = "";
                    if (commandMessage.kickType === "playerName") {
                        client = this.server.clients.find(client => client.player.name === commandMessage.playerName);
                        name = commandMessage.playerName;
                    } else if (commandMessage.kickType === "accountName") {
                        client = this.server.clients.find(client => this.server.userManager.getUser(client)?.name === commandMessage.accountName);
                        name = commandMessage.accountName;
                    }

                    response = makeFailureResponse(commandMessage, `No such player "${name}.`);
                    if (typeof client !== "undefined") {
                        client.disconnect(commandMessage.reason);
                        response = makeSuccessResponse(commandMessage, `Successfully kicked player "${name}".`);
                    }
                }
                break;
            case "mute":
                response = makeFailureResponse(commandMessage, `Muting is not supported on this dimension.`);
                break;
            case "ban": {
                    let client: Client | undefined = undefined;
                    let name = commandMessage.banType !== "accountName" ? commandMessage.playerName : commandMessage.accountName;
                    let ip: string | undefined = undefined;
                    if (commandMessage.banType === "playerName") {
                        client = this.server.clients.find(client => client.player.name === commandMessage.playerName);
                    } else if (commandMessage.banType === "accountName") {
                        client = this.server.clients.find(client => this.server.userManager.getUser(client)?.name === commandMessage.accountName);
                    } else if (commandMessage.banType === "playerIP") {
                        ip = commandMessage.playerIP;
                        client = this.server.clients.find(client =>
                            this.server.userManager.getUser(client)?.name === commandMessage.playerName
                            && client.ip === ip
                        );
                    }

                    const banningUser = await this.server.userManager.getUserByName(commandMessage.commandUserName);
                    if (typeof client !== "undefined") {
                        const result = await this.server.banManager.banClient(client, commandMessage.reason, banningUser);
                        switch (result.type) {
                            case "OK":
                                response = makeSuccessResponse(commandMessage, `Successfully banned player "${name}"`);
                                break;
                            case "ERROR":
                                response = makeFailureResponse(commandMessage, `Encountered an error trying to ban player "${name}"`);
                                break;
                        }
                    } else if (commandMessage.offline && commandMessage.banType === "accountName") {
                        const user = await this.server.userManager.getUserByName(name);
                        if (user !== null) {
                            const result = await this.server.banManager.banAccount(user, commandMessage.reason, banningUser);
                            switch (result.type) {
                                case "OK":
                                    response = makeSuccessResponse(commandMessage, `Successfully banned user account "${name}"`);
                                    break;
                                case "ERROR":
                                    response = makeFailureResponse(commandMessage, `Encountered an error trying to ban user account "${name}"`);
                                    break;
                            }
                        } else {
                            response = makeFailureResponse(commandMessage, `Could not find user account "${name}" to ban.`);
                        }
                    } else if (commandMessage.offline && commandMessage.banType === "playerName") {
                        const user = await this.server.userManager.getUserByName(name);
                        if (user !== null) {
                            const result = await this.server.banManager.banAccount(user, commandMessage.reason, banningUser);
                            switch (result.type) {
                                case "OK":
                                    response = makeSuccessResponse(commandMessage, `Successfully banned user account "${name}"`);
                                    break;
                                case "ERROR":
                                    response = makeFailureResponse(commandMessage, `Encountered an error trying to ban user account "${name}"`);
                                    break;
                            }
                        } else {
                            response = makeFailureResponse(commandMessage, `Could not find user account "${name}" to ban.`);
                        }
                    } else if (commandMessage.offline && commandMessage.banType === "playerIP" && typeof ip !== "undefined") {
                        const result = await this.server.banManager.banIp(ip, name, null, null, commandMessage.reason, banningUser);
                        switch (result.type) {
                            case "OK":
                                response = makeSuccessResponse(commandMessage, `Successfully banned ip "${ip}"`);
                                break;
                            case "ERROR":
                                response = makeFailureResponse(commandMessage, `Encountered an error trying to ban ip "${ip}"`);
                                break;
                        }
                    } else {
                        response = makeFailureResponse(commandMessage, `Couldn't find player to ban. Trying using -o to specify an offline ban.`);
                    }
                }
                break;
        }
        this._rabbit.publish("phase_in", JSON.stringify(response));
    }

    public handleClientConnect(client: Client): void {
        if (client.player.name.length > 0) {
            this._rabbit.publish("phase_in", JSON.stringify({
                token: config.token,
                type: "player_join",
                name: client.player.name,
                ip: client.ip
            }));
        }
    }

    public handleClientDisconnect(client: Client): void {
        if (client.player.name.length > 0) {
            this._rabbit.publish("phase_in", JSON.stringify({
                token: config.token,
                type: "player_leave",
                name: client.player.name,
                ip: client.ip
            }));
        }
    }

    public handleClientRename(client: Client, newName: string): void {
        this.handleClientDisconnect(client);
        client.player.name = newName;
        this.handleClientConnect(client);
    }

    public modifyChat(client: Client, message: ChatMessage): void {
        if (message.content.length === 0) {
            return;
        }

        const user = this.server.userManager.getUser(client);
        const group = this.server.userManager.getUserGroup(client);
        if (group !== null) {
            this._rabbit.publish("phase_in", JSON.stringify({
                token: config.token,
                type: "player_chat",
                name: client.player.name,
                prefix: group.prefix,
                suffix: group.suffix,
                message: message.content,
                R: group.color.split(",")[0],
                G: group.color.split(",")[1],
                B: group.color.split(",")[2],
                ip: client.ip,
                id: user !== null ? user.id : -1,
                accountName: user !== null ? user.name : ""
            }));
        }
    }
}

export default Phase;

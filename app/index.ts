import ChatMessage from "terrariaserver-lite/chatmessage";
import Client from "terrariaserver-lite/client";
import ChatPacketFactory from "terrariaserver-lite/packets/chatfactory";
import TerrariaServer from "terrariaserver-lite/terrariaserver";
import Extension from "terrariaserver-lite/extensions/extension";
import { config } from "./configloader.js";
import RabbitMQ from "./rabbitmq.js";
import * as util from "util";
import * as uuid from "uuid";

interface PhaseMessage {
    token: string;
    type: string;
    excludeInstanceIds?: string[];
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
    instanceId: string;
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

function makeSuccessResponse(instanceId: string, commandMessage: PhaseCommandMessage, response: string): PhaseCommandSuccessResponse {
    return {
        type: "commandResponse",
        instanceId,
        sender: commandMessage.sender,
        discID: commandMessage.discID,
        state: "success",
        responseMessage: response,
    };
}

function makeFailureResponse(instanceId: string, commandMessage: PhaseCommandMessage, response: string): PhaseCommandFailureResponse {
    return {
        type: "commandResponse",
        instanceId,
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
    private _syncOnlinePlayersTimer: NodeJS.Timeout | null = null;
    private _instanceId = uuid.v4();

    constructor(server: TerrariaServer) {
        super(server);
        this._rabbit = new RabbitMQ(server.logger);
        this._rabbit.on("connected", () => this.onConnect());
        this.doConnect();
        this._syncOnlinePlayersTimer = setInterval(() => this.syncOnlinePlayers(server), 5000);
    }

    private async doConnect() {
        while (true) {
            try {
                await this.connect();
                return;
            } catch (e) {
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
            type: "started",
            instanceId: this._instanceId.toString(),
        }));
    }

    public dispose(): void {
        this.server.logger.info("Disposing Phase Extension. \n" + (new Error("Disposed at").stack))
        super.dispose();
        if (this._rabbit) {
            this._rabbit.close();
        }
        const timer = this._syncOnlinePlayersTimer;
        if (timer) {
            clearInterval(timer);
        }
    }

    private async connect(): Promise<void> {
        await this._rabbit.connect();
    }

    private handlePhaseMessage(message: PhaseMessage): void {
        if (message.token !== config.token) {
            return;
        }

        if (message.excludeInstanceIds && message.excludeInstanceIds.includes(this._instanceId.toString())) {
            return;
        }

        if (message.type === "chat") {
            const chatMessage = message as PhaseChatMessage;
            let packet: Buffer | null = null;
            if (chatMessage.prefix === null) {
                try {
                    const message = `${chatMessage.originServer}> <${chatMessage.name}> ${chatMessage.suffix || ""}: ${chatMessage.contentRaw.plain}`;
                    packet = ChatPacketFactory.make(
                        message,
                        {
                            R: chatMessage.R,
                            G: chatMessage.G,
                            B: chatMessage.B
                        }
                    );
                } catch (e) {
                    const error = util.inspect(e, { showHidden: false, depth: null });
                    this.server.logger.error(`Encountered error trying to send this message:"${message}"\nError: ${error}`)
                }
            } else {
                const message = `${chatMessage.originServer}> [${chatMessage.prefix}] <${chatMessage.name}> ${chatMessage.suffix || ""}: ${chatMessage.contentRaw.plain}`;
                try {
                    packet = ChatPacketFactory.make(
                        message,
                        {
                            R: chatMessage.R,
                            G: chatMessage.G,
                            B: chatMessage.B
                        }
                    );
                } catch (e) {
                    const error = util.inspect(e, { showHidden: false, depth: null });
                    this.server.logger.error(`Encountered error trying to send this message:"${message}"\nError: ${error}`)
                }
            }

            if (packet != null) {
                for (const client of this.server.clients) {
                    client.sendPacket(packet);
                }
            }
        } else if (message.type === "command") {
            this.handlePhaseCommand(message as PhaseCommandMessage);
        }
    }

    private async handlePhaseCommand(commandMessage: PhaseCommandMessage) {
        let response: PhaseCommandResponse = makeFailureResponse(this._instanceId.toString(), commandMessage, "Could not determine command");
        switch (commandMessage.commandName) {
            case "kick": {
                let client: Client | undefined = undefined;
                let name = "";
                if (commandMessage.kickType === "playerName") {
                    client = this.server.clients.find(client => client.player.name === commandMessage.playerName);
                    name = commandMessage.playerName;
                } else if (commandMessage.kickType === "accountName") {
                    client = this.server.clients.find(client => this.server.userManager?.getUser(client)?.name === commandMessage.accountName);
                    name = commandMessage.accountName;
                }

                response = makeFailureResponse(this._instanceId.toString(), commandMessage, `No such player "${name}.`);
                if (typeof client !== "undefined") {
                    client.disconnect(commandMessage.reason);
                    response = makeSuccessResponse(this._instanceId.toString(), commandMessage, `Successfully kicked player "${name}".`);
                }
            }
                break;
            case "mute":
                response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Muting is not supported on this dimension.`);
                break;
            case "ban": {
                let client: Client | undefined = undefined;
                let name = commandMessage.banType !== "accountName" ? commandMessage.playerName : commandMessage.accountName;
                let ip: string | undefined = undefined;
                if (commandMessage.banType === "playerName") {
                    client = this.server.clients.find(client => client.player.name === commandMessage.playerName);
                } else if (commandMessage.banType === "accountName") {
                    client = this.server.clients.find(client => this.server.userManager?.getUser(client)?.name === commandMessage.accountName);
                } else if (commandMessage.banType === "playerIP") {
                    ip = commandMessage.playerIP;
                    client = this.server.clients.find(client =>
                        this.server.userManager?.getUser(client)?.name === commandMessage.playerName
                        && client.ip === ip
                    );
                }

                const banningUser = await this.server.userManager?.getUserByName(commandMessage.commandUserName);
                if (typeof client !== "undefined") {
                    const result = await this.server.banManager.banClient(client, commandMessage.reason, banningUser);
                    switch (result.type) {
                        case "OK":
                            response = makeSuccessResponse(this._instanceId.toString(), commandMessage, `Successfully banned player "${name}"`);
                            break;
                        case "ERROR":
                            response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Encountered an error trying to ban player "${name}"`);
                            break;
                    }
                } else if (commandMessage.offline && commandMessage.banType === "accountName") {
                    const user = await this.server.userManager?.getUserByName(name);
                    if (typeof user !== "undefined" && user !== null) {
                        const result = await this.server.banManager.banAccount(user, commandMessage.reason, banningUser);
                        switch (result.type) {
                            case "OK":
                                response = makeSuccessResponse(this._instanceId.toString(), commandMessage, `Successfully banned user account "${name}"`);
                                break;
                            case "ERROR":
                                response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Encountered an error trying to ban user account "${name}"`);
                                break;
                        }
                    } else {
                        response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Could not find user account "${name}" to ban.`);
                    }
                } else if (commandMessage.offline && commandMessage.banType === "playerName") {
                    const user = await this.server.userManager?.getUserByName(name);
                    if (typeof user !== "undefined" && user !== null) {
                        const result = await this.server.banManager.banAccount(user, commandMessage.reason, banningUser);
                        switch (result.type) {
                            case "OK":
                                response = makeSuccessResponse(this._instanceId.toString(), commandMessage, `Successfully banned user account "${name}"`);
                                break;
                            case "ERROR":
                                response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Encountered an error trying to ban user account "${name}"`);
                                break;
                        }
                    } else {
                        response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Could not find user account "${name}" to ban.`);
                    }
                } else if (commandMessage.offline && commandMessage.banType === "playerIP" && typeof ip !== "undefined") {
                    const result = await this.server.banManager.banIp(ip, name, null, null, commandMessage.reason, banningUser);
                    switch (result.type) {
                        case "OK":
                            response = makeSuccessResponse(this._instanceId.toString(), commandMessage, `Successfully banned ip "${ip}"`);
                            break;
                        case "ERROR":
                            response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Encountered an error trying to ban ip "${ip}"`);
                            break;
                    }
                } else {
                    response = makeFailureResponse(this._instanceId.toString(), commandMessage, `Couldn't find player to ban. Trying using -o to specify an offline ban.`);
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
                instanceId: this._instanceId.toString(),
                name: client.player.name,
                ip: client.ip,
                uuid: client.player.uuid,
            }));
        }
    }

    public handleClientDisconnect(client: Client): void {
        if (client.player.name.length > 0) {
            this._rabbit.publish("phase_in", JSON.stringify({
                token: config.token,
                type: "player_leave",
                instanceId: this._instanceId.toString(),
                name: client.player.name,
                ip: client.ip,
                uuid: client.player.uuid,
            }));
        }
    }

    public handleClientRename(client: Client, newName: string): void {
        this.handleClientDisconnect(client);
        client.player.name = newName;
        this.handleClientConnect(client);
    }

    syncOnlinePlayers(server: TerrariaServer) {
        const players = server.clients.map(client => {
            return {
                name: client.player.name,
                uuid: client.player.uuid,
                ip: client.ip,
            }
        })
        this._rabbit.publish("phase_in", JSON.stringify({
            token: config.token,
            type: "online_players",
            instanceId: this._instanceId.toString(),
            players: players,
        }));
    }

    public modifyChat(client: Client, message: ChatMessage): void {
        if (message.content.length === 0) {
            return;
        }

        const user = this.server.userManager?.getUser(client);
        const group = this.server.userManager?.getUserGroup(client);
        if (typeof group !== "undefined" && group !== null) {
            this._rabbit.publish("phase_in", JSON.stringify({
                token: config.token,
                type: "player_chat",
                instanceId: this._instanceId.toString(),
                name: client.player.name,
                prefix: group.prefix,
                suffix: group.suffix,
                message: message.content,
                R: group.color.split(",")[0],
                G: group.color.split(",")[1],
                B: group.color.split(",")[2],
                ip: client.ip,
                id: typeof user !== "undefined" && user !== null ? user.id : -1,
                accountName: typeof user !== "undefined" && user !== null ? user.name : "",
                uuid: client.player.uuid,
            }));
        }
    }
}

export default Phase;

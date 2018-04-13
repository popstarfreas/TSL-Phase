import * as Winston from "winston";
import ChatMessage from "../../chatmessage";
import Client from "../../client";
import Database from "../../database";
import ChatPacketFactory from "../../packets/chatfactory";
import TerrariaServer from "../../terrariaserver";
import Extension from "../extension";
import { config } from "./configloader";
import RabbitMQ from "./rabbitmq";

interface PhaseMessage {
    token: string;
    type: string;
}

interface PhaseChatMessage extends PhaseMessage {
    content: string;
    chatType: string;
    R: number;
    G: number;
    B: number;
}

class Phase extends Extension {
    public name = "Phase";
    public version = "v1.0";
    public static order = 1;
    private _rabbit: RabbitMQ;

    constructor(server: TerrariaServer) {
        super(server);
        this._rabbit = new RabbitMQ();
        this.connect();
    }

    public dispose(): void {
        super.dispose();
        if (this._rabbit) {
            this._rabbit.close();
        }
    }

    private async connect(): Promise<void> {
        await this._rabbit.connect();
        this._rabbit.subscribe(config.subExchangeName, (message: PhaseMessage) => {
            if (message.token === config.token && message.type === "chat") {
                const chatMessage = message as PhaseChatMessage;
                const packet = ChatPacketFactory.make(chatMessage.content, {
                    R: chatMessage.R,
                    G: chatMessage.G,
                    B: chatMessage.B
                });

                for (const client of this.server.clients) {
                    client.sendPacket(packet);
                }
            }
        });
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

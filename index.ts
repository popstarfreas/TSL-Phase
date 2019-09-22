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

class Phase extends Extension {
    public name = "Phase";
    public version = "v1.0";
    public static order = 1;
    private _rabbit: RabbitMQ;

    constructor(server: TerrariaServer) {
        super(server);
        this._rabbit = new RabbitMQ(server.logger);
        this.connect();
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
        this._rabbit.subscribe(config.subExchangeName, (message: PhaseMessage) => {
            this.handlePhaseMessage(message);
        });

        this._rabbit.publish("phase_in", JSON.stringify({
            token: config.token,
            type: "started"
        }));
    }

    private handlePhaseMessage(message: PhaseMessage): void {
        if (message.token === config.token && message.type === "chat") {
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
        }
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

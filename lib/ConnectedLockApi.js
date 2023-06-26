"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const homey_oauth2app_1 = require("homey-oauth2app");
class ConnectedLockApiImpl extends homey_oauth2app_1.OAuth2Client {
    async getBridges() {
        return await this.get({
            path: '/users/bridges/mine',
        });
    }
    async getLockInfo(LockID) {
        return await this.get({
            path: `/locks/${LockID}`,
        });
    }
    async getLocks() {
        return await this.get({
            path: '/users/locks/mine',
        });
    }
    async getLockStatus(LockID) {
        return await this.get({
            path: `/locks/${LockID}/status`,
        });
    }
    async forceLockStatus(LockID) {
        return await this.put({
            path: `/remoteoperate/${LockID}/status`,
        });
    }
    async lock(LockID) {
        return await this.put({
            path: `/remoteoperate/${LockID}/lock?retryLimit=1`, // Set retry limit to 1 to prevent random lock/unlock should the API time out (feature/bug with unexpected effects).
        });
    }
    async unlock(LockID) {
        return await this.put({
            path: `/remoteoperate/${LockID}/unlock?retryLimit=1`, // Set retry limit to 1 to prevent random lock/unlock should the API time out (feature/bug with unexpected effects).
        });
    }
    async registerWebhook(webhookUrl, LockID) {
        return await this.post({
            path: `/webhook/${LockID}`,
            json: {
                url: webhookUrl,
                clientID: homey_1.default.env.CLIENT_ID,
                method: "POST",
                notificationTypes: ["operation", "battery"],
            }
        });
    }
    async unregisterWebhook(LockID) {
        return await this.delete({
            path: `/webhook/${LockID}/${homey_1.default.env.CLIENT_ID}`,
        });
    }
    async loadPIN(LockID, pin, name, webhook) {
        pin = pin.trim();
        await this.deletePIN(LockID, pin, webhook, name);
        return await this.post({
            path: `/locks/${LockID}/pins`,
            json: {
                commands: [{
                        partnerUserID: pin,
                        pin: pin,
                        firstName: "Homey PIN",
                        lastName: name,
                        action: "load",
                        accessType: "always"
                    }],
                webhook: webhook,
            }
        });
    }
    async deletePIN(LockID, pin, webhook, name = 'User') {
        pin = pin.trim();
        if (pin.length < 4 || pin.length > 6 || isNaN(Number(pin))) {
            throw new Error(`Pin should be 4-6 digits, ${pin} given`);
        }
        return await this.post({
            path: `/locks/${LockID}/pins`,
            json: {
                commands: [{
                        partnerUserID: pin,
                        firstName: "Homey PIN",
                        lastName: name,
                        action: "delete",
                        accessType: "always"
                    }],
                webhook: webhook,
            }
        });
    }
    async get(data) {
        return super.get(this.addHeaders(data));
    }
    async delete(data) {
        return super.delete(this.addHeaders(data));
    }
    async post(data) {
        return super.post(this.addHeaders(data));
    }
    async put(data) {
        return super.put(this.addHeaders(data));
    }
    addHeaders(data) {
        const headers = {
            'Content-Type': 'application/json',
            'x-august-access-token': this.getToken()?.access_token,
            'x-august-api-key': ConnectedLockApiImpl.API_KEY
        };
        data.headers = data.headers ? { ...data.headers, ...headers } : headers;
        return data;
    }
    async onHandleNotOK(args) {
        const translation = this.homey.__(`status.${args.status}`); // Will return null if there's no translation known
        if (translation) {
            args.statusText = translation;
        }
        const message = `${args.status} ${args.statusText || 'Unknown Error'}`;
        const err = new Error(message);
        err.status = args.status;
        err.statusText = args.statusText;
        return err;
    }
}
ConnectedLockApiImpl.BASE_URL = homey_1.default.env.API_URL;
ConnectedLockApiImpl.OAUTH_URL = homey_1.default.env.OAUTH_URL;
ConnectedLockApiImpl.API_URL = `${ConnectedLockApiImpl.BASE_URL}`;
ConnectedLockApiImpl.TOKEN_URL = `${ConnectedLockApiImpl.OAUTH_URL}/access_token`;
ConnectedLockApiImpl.AUTHORIZATION_URL = `${ConnectedLockApiImpl.OAUTH_URL}/authorization`;
ConnectedLockApiImpl.SCOPES = ['homey'];
ConnectedLockApiImpl.API_KEY = homey_1.default.env.AUGUST_API_KEY;
module.exports = ConnectedLockApiImpl;
//# sourceMappingURL=ConnectedLockApi.js.map
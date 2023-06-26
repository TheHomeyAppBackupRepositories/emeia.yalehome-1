"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectedLockDriver = void 0;
const homey_oauth2app_1 = require("homey-oauth2app");
const homey_1 = __importDefault(require("homey"));
class ConnectedLockDriver extends homey_oauth2app_1.OAuth2Driver {
    constructor() {
        super(...arguments);
        this._webhook = null;
        this._pin_webhook = null;
    }
    async onOAuth2Init() {
        try {
            await super.onOAuth2Init();
            await this.registerWebhook();
            this._lockTrigger = this.homey.flow.getDeviceTriggerCard('locked_true');
            this._unlockTrigger = this.homey.flow.getDeviceTriggerCard('locked_false');
            this._openTrigger = this.homey.flow.getDeviceTriggerCard('opened');
            this._closedTrigger = this.homey.flow.getDeviceTriggerCard('closed');
            this._doorbellTrigger = this.homey.flow.getDeviceTriggerCard('doorbell');
        }
        catch (e) {
            this.error(e);
            return;
        }
    }
    async registerWebhook() {
        if (this._webhook) {
            await this._webhook.unregister().catch(this.error);
        }
        this._webhook = await this.homey.cloud.createWebhook(homey_1.default.env.WEBHOOK_ID, homey_1.default.env.WEBHOOK_SECRET, {}).catch(this.error);
        this._webhook?.on('message', this._onWebhookMessage.bind(this));
        if (this._pin_webhook) {
            await this._pin_webhook.unregister().catch(this.error);
        }
        this._pin_webhook = await this.homey.cloud.createWebhook(homey_1.default.env.WEBHOOK_PIN_ID, homey_1.default.env.WEBHOOK_PIN_SECRET, {}).catch(this.error);
        this._pin_webhook?.on('message', this._onPinWebhookMessage.bind(this));
    }
    async _onWebhookMessage(message) {
        const data = message.body;
        this.log('Webhook received', data);
        const device = this.getDevices().find(device => device.getData().LockID === data.LockID);
        if (!device) {
            return this.error('Webhook for unknown device received!');
        }
        const event = data.Event;
        switch (data.EventType) {
            case 'system': // Battery event
                if (this.checkTimestamp(data, device, 'battery')) {
                    return;
                }
                device.setBatteryState(event);
                break;
            case 'operation': // Lock event
            case 'status': // Status event
                if (data.User.UserID === 'DoorStateChanged') {
                    if (this.checkTimestamp(data, device, 'doorState')) {
                        return;
                    }
                    if (event === 'open') { // Here to keep existing flows going, contact alarm also has flows
                        this.triggerOpen(device);
                    }
                    else if (event === 'closed') {
                        this.triggerClosed(device);
                    }
                    device.setCapabilityValue('alarm_contact', event === 'open' ? true : event === 'closed' ? false : null).catch(this.error);
                }
                else {
                    if (event === 'invalidcode') {
                        return;
                    }
                    if (this.checkTimestamp(data, device, 'locked')) {
                        return;
                    }
                    const isLocked = ['lock', 'onetouchlock', 'secure'].includes(event);
                    const newValue = isLocked ? 'locked' : 'unlocked';
                    const currentValue = device.getCapabilityValue('lock_unlock_open');
                    const secureLock = event === 'secure';
                    if (currentValue !== newValue) {
                        await device.setCapabilityValue('lock_unlock_open', newValue).catch(this.error);
                        await device.setCapabilityValue('locked.custom', isLocked).catch(this.error);
                        // Only trigger flow if current value was not open, as open will always reset to unlocked and it can only be set from Homey (which triggers the flow)
                        if (currentValue !== 'open' || newValue === 'locked') {
                            let source;
                            if (event === 'onetouchlock') {
                                source = 'Keypad';
                            }
                            else if (data.User.UserID === 'manuallock' || data.User.UserID === 'manualunlock') {
                                source = 'Manual';
                            }
                            else if (data.User.UserID === 'autorelock') {
                                source = 'Auto-lock';
                            }
                            else {
                                source = 'User: ' + data.User.FirstName + ' ' + data.User.LastName;
                            }
                            this.log('Trigger source:', source);
                            if (newValue === 'locked') {
                                this.triggerLock(device, { source: source });
                            }
                            else {
                                this.triggerUnlock(device, { source: source });
                            }
                        }
                    }
                    if (device.hasCapability('secure_lock') && secureLock !== device.getCapabilityValue('secure_lock')) {
                        device.setCapabilityValue('secure_lock', secureLock).catch(this.error);
                    }
                }
                device.webHookSync = true;
                break;
            case 'systemstatus': // Lock online/offline
                if (this.checkTimestamp(data, device, 'systemStatus')) {
                    return;
                }
                switch (event) {
                    case 'online':
                        device.setAvailable().catch(this.error);
                        break;
                    case 'offline':
                        device.setUnavailable(this.homey.__('device_offline')).catch(this.error);
                        break;
                }
                break;
            case 'battery': // Battery for keypad event
                if (this.checkTimestamp(data, device, 'battery')) {
                    return;
                }
                device.setCapabilityValue('alarm_battery', event !== 'keypad_battery_none').catch(this.error);
                break;
            case 'lock_doorbell_buttonpress': // Doorbell was pressed
                if (this.checkTimestamp(data, device, 'doorbell')) {
                    return;
                }
                this.log('Doorbell rang', data);
                this.triggerDoorbell(device);
                break;
            default:
                throw new Error(`Webhook event cannot be handled! Type: ${data.EventType}`);
        }
    }
    checkTimestamp(data, device, timestampName) {
        if (data.Timestamp) {
            if (device.lastTimestamp[timestampName] > data.Timestamp) {
                this.log('Ignoring event as it happened earlier than previously received event');
                return true;
            }
            else {
                device.lastTimestamp[timestampName] = data.Timestamp;
            }
        }
        return false;
    }
    _onPinWebhookMessage(message) {
        const data = message.body;
        this.log('Pin webhook received', data);
        this.log('Digest', data.digest);
        if (data.message === 'PinSyncFail') { // Error occurred
            const errorMessage = [
                ...data.digest.conflict.map((error) => error.reason),
                ...data.digest.error.map((error) => error.reason)
            ].join(', ');
            if (errorMessage === 'Unable to set intent state for pin: No pin given or could not find pin per lock ID and user ID') {
                this.log('Pin does not exist, ignored');
                return;
            }
            this.homey.notifications.createNotification({
                excerpt: `${this.homey.__('pin_error')} ${errorMessage}`,
            });
        }
    }
    async onPairListDevices({ oAuth2Client }) {
        const locks = await oAuth2Client.getLocks().catch(this.error);
        if (!locks) {
            return [];
        }
        this.log('Locks found!', locks);
        return Object.keys(locks).map((key) => this.convertDevice(key, locks[key]));
    }
    convertDevice(id, lock) {
        const result = {
            name: `${lock.HouseName}: ${lock.LockName}`,
            data: {
                LockID: id
            },
        };
        this.log('Device', result);
        return result;
    }
    // eslint-disable-next-line @typescript-eslint/ban-types
    triggerLock(device, tokens) {
        this.log('Triggering lock', tokens);
        const lockValue = device.getCapabilityValue('lock_unlock_open');
        if (lockValue !== 'locked') {
            this.log('Not triggering flow, value changed in the mean time');
            return;
        }
        this._lockTrigger.trigger(device, tokens).catch(this.error);
    }
    // eslint-disable-next-line @typescript-eslint/ban-types
    triggerUnlock(device, tokens) {
        this.log('Triggering unlock', tokens);
        const lockValue = device.getCapabilityValue('lock_unlock_open');
        if (lockValue !== 'unlocked' && lockValue !== 'open') {
            this.log('Not triggering flow, value changed in the mean time');
            return;
        }
        this._unlockTrigger.trigger(device, tokens).catch(this.error);
    }
    triggerOpen(device) {
        this.log('Triggering open');
        const lockValue = device.getCapabilityValue('lock_unlock_open');
        if (lockValue !== 'unlocked' && lockValue !== 'open') {
            this.log('Not triggering flow, value changed in the mean time');
            return;
        }
        this._openTrigger.trigger(device).catch(this.error);
    }
    triggerClosed(device) {
        this.log('Triggering closed');
        this._closedTrigger.trigger(device).catch(this.error);
    }
    triggerDoorbell(device) {
        this.log('Triggering doorbell');
        this._doorbellTrigger.trigger(device).catch(this.error);
    }
}
exports.ConnectedLockDriver = ConnectedLockDriver;
module.exports = ConnectedLockDriver;
//# sourceMappingURL=driver.js.map
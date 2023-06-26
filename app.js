"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const source_map_support_1 = __importDefault(require("source-map-support"));
source_map_support_1.default.install();
const homey_log_1 = require("homey-log");
const homey_oauth2app_1 = require("homey-oauth2app");
const homey_1 = __importDefault(require("homey"));
class ConnectedLockApp extends homey_oauth2app_1.OAuth2App {
    async onOAuth2Init() {
        try {
            await super.onOAuth2Init();
            this.homeyLog = new homey_log_1.Log({ homey: this.homey });
            // Register lock flows
            // Condition
            const lockedCondition = this.homey.flow.getConditionCard('locked');
            lockedCondition.registerRunListener(async (args) => {
                this.log('Checking condition locked');
                return args.device.getCapabilityValue('lock_unlock_open') === 'locked';
            });
            const unlockedCondition = this.homey.flow.getConditionCard('unlocked');
            unlockedCondition.registerRunListener(async (args) => {
                const capabilityValue = args.device.getCapabilityValue('lock_unlock_open');
                this.log('Checking condition unlocked');
                return capabilityValue === 'unlocked' || capabilityValue === 'open';
            });
            const lockedRefreshCondition = this.homey.flow.getConditionCard('locked_refresh');
            lockedRefreshCondition.registerRunListener(async (args) => {
                this.log('Checking condition locked with forced refresh');
                return await args.device.refreshLockStatus().catch(args.device.error);
            });
            const unlockedRefreshCondition = this.homey.flow.getConditionCard('unlocked_refresh');
            unlockedRefreshCondition.registerRunListener(async (args) => {
                this.log('Checking condition unlocked with forced refresh');
                return !(await args.device.refreshLockStatus().catch(args.device.error));
            });
            const secureLockCondition = this.homey.flow.getConditionCard('secure_lock');
            secureLockCondition.registerRunListener((args) => {
                this.log('Checking condition secure locked');
                return args.device.getCapabilityValue('secure_lock');
            });
            // Action
            const lockAction = this.homey.flow.getActionCard('lock');
            lockAction.registerRunListener(async (args) => {
                this.log('Flow action lock triggered');
                await args.device._setCapabilityValue(args, 'locked');
            });
            const unlockAction = this.homey.flow.getActionCard('unlock');
            unlockAction.registerRunListener(async (args) => {
                this.log('Flow action unlock triggered');
                await args.device._setCapabilityValue(args, 'unlocked');
            });
            const openAction = this.homey.flow.getActionCard('open');
            openAction.registerRunListener(async (args) => {
                this.log('Flow action open triggered');
                await args.device._setCapabilityValue(args, 'open');
            });
            // Deprecated cards
            const openedCondition = this.homey.flow.getConditionCard('opened');
            openedCondition.registerRunListener(async (args) => {
                this.log('Checking condition open');
                return args.device.getCapabilityValue('alarm_contact');
            });
            const closedCondition = this.homey.flow.getConditionCard('closed');
            closedCondition.registerRunListener(async (args) => {
                this.log('Checking condition closed');
                return !args.device.getCapabilityValue('alarm_contact');
            });
            // Register PIN flows
            const homeyId = await this.homey.cloud.getHomeyId();
            const addPINAction = this.homey.flow.getActionCard('add_pin');
            addPINAction.registerRunListener(async (args) => {
                this.log('Add pin', args.pin);
                await args.device.oAuth2Client.loadPIN(args.device.id, args.pin, args.name, `https://webhooks.athom.com/webhook/${homey_1.default.env.WEBHOOK_PIN_ID}/?homey=${homeyId}`);
            });
            const delPINAction = this.homey.flow.getActionCard('delete_pin');
            delPINAction.registerRunListener(async (args) => {
                this.log('Delete pin', args.pin);
                await args.device.oAuth2Client.deletePIN(args.device.id, args.pin, `https://webhooks.athom.com/webhook/${homey_1.default.env.WEBHOOK_PIN_ID}/?homey=${homeyId}`);
            });
            this.log('App has been initialized');
        }
        catch (e) {
            this.log('App failed to initialize');
            this.error(e);
        }
    }
}
ConnectedLockApp.OAUTH2_CLIENT = require('./lib/ConnectedLockApi');
ConnectedLockApp.OAUTH2_DEBUG = true;
module.exports = ConnectedLockApp;
//# sourceMappingURL=app.js.map
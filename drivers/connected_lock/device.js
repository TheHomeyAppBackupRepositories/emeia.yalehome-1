"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectedLockDevice = void 0;
const homey_oauth2app_1 = require("homey-oauth2app");
const homey_1 = __importDefault(require("homey"));
class ConnectedLockDevice extends homey_oauth2app_1.OAuth2Device {
    constructor() {
        super(...arguments);
        this.id = '';
        this.webHookSync = false;
        this.batteryStatusTimeout = null;
        this.lastTimestamp = {
            battery: 0,
            locked: 0,
            doorState: 0,
            systemStatus: 0,
            doorbell: 0,
        };
    }
    async onOAuth2Init() {
        // Store device data in class
        this.id = this.getData().LockID;
        // Handle capability changes
        await this.removeCapabilityIfPresent('door_state');
        await this.addCapabilityIfNotPresent('alarm_contact');
        await this.removeCapabilityIfPresent('locked');
        await this.addCapabilityIfNotPresent('locked.custom');
        await this.addCapabilityIfNotPresent('secure_lock');
        await this.removeCapabilityIfPresent('command_refresh_battery');
        await this.addCapabilityIfNotPresent('button.refresh_battery');
        // Register listeners
        this.registerCapabilityListener('lock_unlock_open', async (capabilityValue) => {
            const currentValue = this.getCapabilityValue('lock_unlock_open');
            this.log('Capability lock_unlock_open changed', capabilityValue, currentValue);
            this.log('Stack trace', (new Error()).stack);
            if (currentValue === capabilityValue) {
                this.log('Value did not change?');
                return;
            }
            await this.handleCapabilityChange(capabilityValue, currentValue);
            await this.setCapabilityValue('locked.custom', capabilityValue === 'locked').catch(this.error);
        });
        this.registerCapabilityListener('locked.custom', async (capabilityValue) => {
            const currentValue = this.getCapabilityValue('locked.custom');
            this.log('Capability locked.custom changed', capabilityValue, currentValue);
            this.log('Stack trace', (new Error()).stack);
            if (currentValue === capabilityValue) {
                this.log('Value did not change?');
                return;
            }
            await this.triggerCapabilityListener('lock_unlock_open', capabilityValue ? 'locked' : 'unlocked').catch(this.error);
        });
        this.registerCapabilityListener('button.refresh_battery', async (pressed) => {
            if (!pressed) {
                return;
            }
            if (this.batteryStatusTimeout !== null) {
                throw new Error(this.homey.__('battery_timeout_running'));
            }
            this.log('Refreshing battery status');
            const lockInfo = await this.oAuth2Client.getLockInfo(this.id);
            this.setBatteryState(lockInfo.batteryInfo.warningState);
            this.batteryStatusTimeout = this.homey.setTimeout(() => this.batteryStatusTimeout = null, 60000); // Only allow this once per minute
        });
        // Initial state
        const lockStatus = await this.oAuth2Client.getLockStatus(this.id);
        this.log('Initial lock status', lockStatus);
        this.setAvailable().catch(this.error);
        const doorState = lockStatus.doorState;
        this.setCapabilityValue('alarm_contact', doorState === 'open' ? true : doorState === 'closed' ? false : null).catch(this.error);
        this.setCapabilityValue('locked.custom', lockStatus.status === 'locked').catch(this.error);
        this.webHookSync = true;
        if (['locked', 'unlocked', 'open'].includes(lockStatus.status)) {
            this.setCapabilityValue('lock_unlock_open', lockStatus.status).catch(this.error);
        }
        // Refresh battery state
        this.triggerCapabilityListener('button.refresh_battery', true)
            .then(() => {
            if (!this.batteryStatusTimeout) {
                return;
            }
            clearTimeout(this.batteryStatusTimeout);
            this.batteryStatusTimeout = null;
        })
            .catch(this.error);
    }
    async removeCapabilityIfPresent(capability) {
        if (!this.hasCapability(capability)) {
            return;
        }
        this.log('Removing capability', capability);
        await this.removeCapability(capability).catch(this.error);
    }
    async addCapabilityIfNotPresent(capability) {
        if (this.hasCapability(capability)) {
            return;
        }
        this.log('Adding capability', capability);
        await this.addCapability(capability).catch(this.error);
    }
    async refreshLockStatus() {
        const newState = await this.oAuth2Client.forceLockStatus(this.id).catch(this.error);
        if (!newState) {
            return false;
        }
        this.log('Lock state after refresh', newState);
        const newValue = newState.status;
        if (newValue === 'unknown') {
            this.log('Unknown lock state, condition fails');
            return false;
        }
        const currentValue = this.getCapabilityValue('lock_unlock_open');
        if (currentValue !== newValue) {
            await this.setCapabilityValue('lock_unlock_open', ConnectedLockDevice.lockStatusMap[newValue]).catch(this.error);
            await this.setCapabilityValue('locked.custom', ConnectedLockDevice.lockStatusMap[newValue] === 'locked').catch(this.error);
        }
        await this.setCapabilityValue('alarm_contact', ConnectedLockDevice.doorStatusMap[newState.doorState]).catch(this.error);
        return this.getCapabilityValue('lock_unlock_open') === 'locked';
    }
    async _setCapabilityValue(args, capabilityValue) {
        if (this.id !== args.device.id) {
            return;
        }
        this.log('Setting lock_unlock_open capability by flow action to', capabilityValue);
        await this.triggerCapabilityListener('lock_unlock_open', capabilityValue).catch(this.error);
    }
    setBatteryState(warningState) {
        this.setCapabilityValue('alarm_battery', warningState !== 'lock_state_battery_warning_none').catch(this.error);
    }
    async handleCapabilityChange(capabilityValue, previousValue) {
        this.log('New capability value', capabilityValue);
        const currentStatus = await this.oAuth2Client.getLockStatus(this.id).catch(this.error); // Can be unlocked or locked, so open will always continue
        this.log('Retrieved lock status', currentStatus);
        if (!currentStatus || currentStatus.status === capabilityValue) {
            // No action required when external state is in sync
            return;
        }
        this.webHookSync = false;
        const rejectAction = (error, device, previousStatus, previousValue) => {
            if (device.webHookSync) {
                device.log('State has been updated, no revert necessary');
                return;
            }
            if (previousStatus === 'unknown') {
                device.log('Previous status unknown, resetting to previous set value');
                previousStatus = previousValue;
            }
            device.log('Resetting previous state due to missing webhook confirmation', previousStatus);
            device.setCapabilityValue('lock_unlock_open', previousStatus).catch(device.error);
            device.setCapabilityValue('locked.custom', previousStatus === 'locked').catch(device.error);
            device.error(error);
        };
        const successAction = (device, newStatus) => {
            switch (newStatus) {
                case 'unlocked':
                    device.driver.triggerUnlock(this, { source: 'Homey' });
                    break;
                case 'open':
                    device.driver.triggerOpen(this);
                    break;
                case 'locked':
                    device.driver.triggerLock(this, { source: 'Homey' });
                    break;
                default:
                    device.error('Unknown status', newStatus);
            }
        };
        if (capabilityValue === 'unlocked' || capabilityValue === 'open') { // When set to open, simply use the command again to open the door
            this.oAuth2Client.unlock(this.id)
                .catch((e) => rejectAction(e, this, currentStatus.status, previousValue))
                .then(() => successAction(this, capabilityValue));
        }
        else {
            this.oAuth2Client.lock(this.id)
                .catch((e) => rejectAction(e, this, currentStatus.status, previousValue))
                .then(() => successAction(this, capabilityValue));
        }
    }
    async onOAuth2Added() {
        await this.driver.ready().catch(this.error);
        // Register webhook for this device
        const homeyId = await this.homey.cloud.getHomeyId().catch(this.error);
        await this.oAuth2Client.registerWebhook(`https://webhooks.athom.com/webhook/${homey_1.default.env.WEBHOOK_ID}?homey=${homeyId}`, this.id).catch(this.error);
    }
    async onOAuth2Deleted() {
        await this.oAuth2Client.unregisterWebhook(this.id).catch(this.error);
    }
}
exports.ConnectedLockDevice = ConnectedLockDevice;
ConnectedLockDevice.lockStatusMap = {
    kAugLockState_Locked: 'locked',
    kAugLockState_Unlocked: 'unlocked',
};
ConnectedLockDevice.doorStatusMap = {
    kAugDoorState_Open: true,
    kAugDoorState_Ajar: true,
    kAugDoorState_Closed: false,
    kAugDoorState_Unknown: null,
    kAugDoorState_Init: null,
};
module.exports = ConnectedLockDevice;
//# sourceMappingURL=device.js.map
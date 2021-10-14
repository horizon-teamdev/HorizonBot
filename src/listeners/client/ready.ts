import { ApplyOptions } from '@sapphire/decorators';
import type { ListenerOptions } from '@sapphire/framework';
import { Listener } from '@sapphire/framework';
import type { TextChannel } from 'discord.js';
import Eclass from '@/models/eclass';
import FlaggedMessageDB from '@/models/flaggedMessage';
import ReactionRole from '@/models/reactionRole';
import FlaggedMessage from '@/structures/FlaggedMessage';
import { ConfigEntriesChannels, EclassStatus } from '@/types/database';

@ApplyOptions<ListenerOptions>({ once: true })
export default class ReadyListener extends Listener {
  public async run(): Promise<void> {
    this.container.client.checkValidity();

    this.container.logger.info('[Logs] Syncing logs statuses...');
    await this.container.client.syncLogStatuses();

    this.container.logger.info('[ConfigurationManager] Caching configured channels...');
    await this.container.client.configManager.loadAll();

    this.container.logger.info('[Logs] Caching invites...');
    for (const guild of this.container.client.guilds.cache.values())
      await guild.invites.fetch();

    this.container.logger.info('[Reaction Roles] Caching reactions-roles menus...');
    const reactionRoles = await ReactionRole.find();
    for (const rr of reactionRoles) {
      // TODO: Improve the "remove-if-fail" logic. What if the channel was deleted? What if we just don't have perm?
      const channel = this.container.client.channels.cache.get(rr.channelId) as TextChannel;
      channel?.messages.fetch(rr.messageId)
        .catch(async () => {
          // If we failed to fetch the message, it is likely that it has been deleted, so we remove it too.
          await ReactionRole.findByIdAndDelete(rr._id);
          this.container.client.reactionRolesIds.delete(rr.messageId);
        });
    }

    this.container.logger.info('[Reaction Roles] Caching eclass announcement...');
    const eclasses = await Eclass.find({ status: EclassStatus.Planned });
    for (const eclass of eclasses) {
      // TODO: Improve the "remove-if-fail" logic. What if the channel was deleted? What if we just don't have perm?
      const channel = await this.container.client.configManager.get(eclass.announcementChannel, eclass.guild);
      channel?.messages.fetch(eclass.announcementMessage)
        .catch(async () => {
          // If we failed to fetch the message, it is likely that it has been deleted, so we remove it too.
          await ReactionRole.findByIdAndDelete(eclass._id);
          this.container.client.reactionRolesIds.delete(eclass.announcementMessage);
        });
    }

    this.container.logger.info('[Anti Swear] Caching alert messages...');
    let flaggedMessages = await FlaggedMessageDB.find({ approved: false });
    for (const flaggedMessage of flaggedMessages) {
      // TODO: Improve the "remove-if-fail" logic. What if the channel was deleted? What if we just don't have perm?
      const logChannel = await this.container.client.configManager.get(
        ConfigEntriesChannels.ModeratorFeedback,
        flaggedMessage.guildId,
      );
      logChannel?.messages.fetch(flaggedMessage.alertMessageId)
        .catch(async () => {
          // If we failed to fetch the message, it is likely that it has been deleted, so we remove it too.
          await FlaggedMessageDB.findByIdAndDelete(flaggedMessage._id);
          flaggedMessages = flaggedMessages.filter(msg => msg._id !== flaggedMessage._id);
          this.container.client.waitingFlaggedMessages = this.container.client.waitingFlaggedMessages
            .filter(elt => elt.message.id !== flaggedMessage.messageId);
        });
    }

    // TODO: Do we even need to parse them all now?
    // FIXME: dont await each in the loop, parse them all in parallel and bulk-add them after.
    for (const flaggedMessage of flaggedMessages) {
      const parsedFlaggedMessage = await FlaggedMessage.fromDocument(flaggedMessage);
      this.container.client.waitingFlaggedMessages.push(parsedFlaggedMessage);
    }

    this.container.logger.info('All caching done!');
  }
}

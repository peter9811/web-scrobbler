import { CustomStorage } from '@/background/storage/custom-storage';
import { SongInfo } from '@/background/object/song';

export abstract class ScrobbleStorageModel extends CustomStorage {
	/* Public methods */

	async addSong(songInfo: SongInfo, scrobblerIds: string[]): Promise<void> {
		const storageData = await this.getData();
		const entryId = ScrobbleStorageModel.generateEntryId();

		storageData[entryId] = { scrobblerIds, songInfo };
		await this.saveData(storageData);
	}

	/* Static methods */

	static generateEntryId(): string {
		const uniqueNumber = Date.now();
		return `id-${uniqueNumber}`;
	}
}

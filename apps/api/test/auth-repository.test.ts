import { describe, expect, it, vi } from 'vitest';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { MongoAuthRepository } from '../src/modules/auth/repository.js';
import { AuthService } from '../src/modules/auth/service.js';

describe('Credential changes during login transactions', () => {
  it('rejects an observed old password hash without deleting or minting a session', async () => {
    const connection = mongoose.createConnection();
    const repository = new MongoAuthRepository(connection, async () => false);
    const service = new AuthService(
      repository,
      { available: async () => {}, send: async () => {} },
      {
        APP_ORIGIN: 'http://127.0.0.1:5173',
        NODE_ENV: 'test',
        SESSION_IDLE_MINUTES: 60,
        SESSION_ABSOLUTE_HOURS: 24,
      },
    );
    const userId = new Types.ObjectId();
    const { session } = service.newSession(userId);
    const previousSession = new Types.ObjectId().toString();
    const observedOldHash = 'hash-observed-before-reset';
    // The transactional update sees no user matching that old hash after a
    // concurrent reset committed. This models the persistence-port response;
    // live replica-set behavior is covered by the isolated auth verification.
    const query = repository.models.users.findOneAndUpdate({ _id: userId });
    vi.spyOn(query, 'lean').mockResolvedValue(null);
    const fence = vi.spyOn(repository.models.users, 'findOneAndUpdate').mockReturnValue(query);
    const deletePrevious = vi.spyOn(repository.models.sessions, 'deleteOne');
    const createSession = vi.spyOn(repository.models.sessions, 'create');
    vi.spyOn(connection, 'transaction').mockImplementation(async (operation) =>
      operation({} as ClientSession),
    );
    await expect(
      repository.rotateSession(session, previousSession, observedOldHash),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(fence).toHaveBeenCalledWith(
      { _id: userId, passwordHash: observedOldHash },
      { $inc: { authRevision: 1 } },
      expect.objectContaining({ session: expect.any(Object) }),
    );
    expect(deletePrevious).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    await connection.close();
  });
});

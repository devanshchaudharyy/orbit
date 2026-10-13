import { CollaborationRepository } from './repository.js';
export class CollaborationService {
  constructor(readonly repository: CollaborationRepository) {}
  ready = () => this.repository.ready();
}

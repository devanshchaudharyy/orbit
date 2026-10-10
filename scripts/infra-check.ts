import { checkInfrastructure } from '../apps/api/test/infrastructure.js';
process.exitCode = (await checkInfrastructure()) ? 0 : 1;

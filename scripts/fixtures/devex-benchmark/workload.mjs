const profile = process.argv[2];
if (!['cold', 'warm', 'one-file'].includes(profile)) process.exitCode = 2;

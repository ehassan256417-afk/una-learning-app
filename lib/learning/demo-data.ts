import type { Course, Difficulty, Flashcard, LearningLevel, NoteCard, Provenance, QuizQuestion, Section } from './types';

/**
 * DEMO DATA ONLY.
 *
 * Everything in this file is hand-written sample content so the prototype can
 * be explored end to end. None of it was extracted from, or verified against,
 * a real course PDF. Every item is tagged `{ kind: 'demo' }` and the UI labels
 * it as demo data wherever it is shown.
 */

const DEMO: Provenance = { kind: 'demo' };

const note = (id: string, title: string, body: string, extra: Partial<NoteCard> = {}): NoteCard => ({
  id,
  title,
  body,
  provenance: DEMO,
  ...extra,
});

const question = (
  id: string,
  level: LearningLevel,
  prompt: string,
  choices: string[],
  answerIndex: number,
  explanation: string,
): QuizQuestion => ({ id, level, prompt, choices, answerIndex, explanation, xp: level * 10, provenance: DEMO });

const card = (id: string, front: string, back: string): Flashcard => ({ id, front, back, provenance: DEMO });

const section = (
  s: Omit<Section, 'provenance' | 'xpReward' | 'estMinutes' | 'difficulty'> & {
    estMinutes?: string;
    difficulty?: Difficulty;
    xpReward?: number;
  },
): Section => ({ estMinutes: '8–10 min', difficulty: 'Beginner', xpReward: 30, provenance: DEMO, ...s });

const cis344: Course = {
  id: 'cis-344',
  code: 'CIS 344',
  title: 'IT Infrastructure',
  unitLabel: 'Module 4',
  unitTitle: 'System Auditing',
  pages: 42,
  accent: 'purple',
  provenance: DEMO,
  sections: [
    section({
      id: 'getting-started',
      title: 'Getting Started with System Auditing',
      estMinutes: '5–7 min',
      objectives: [
        'Explain what a system audit is.',
        'Describe why organizations audit their systems.',
        'Tell an audit apart from monitoring.',
      ],
      keyPoints: [
        'An audit is a structured review of how a system is configured and used.',
        'Audits compare what is actually happening against what policy says should happen.',
        'Monitoring is continuous; an audit is a point-in-time review.',
      ],
      notes: [
        note('gs-n1', 'What is a system audit?', 'A system audit is a structured review of how a system is configured and used. The auditor collects evidence and compares it against a policy or baseline.', { keyTerm: 'baseline' }),
        note('gs-n2', 'Audit vs. monitoring', 'Monitoring watches a system continuously and raises alerts. An audit is a point-in-time review that asks whether the system matches what the rules require.', { keyTerm: 'point-in-time' }),
      ],
      questions: [
        question('gs-q1', 1, 'What does a system audit compare?', ['Two different operating systems', 'Actual system state against a policy or baseline', 'Hardware prices over time', 'The speed of two networks'], 1, 'An audit collects evidence about the real system and compares it to what the policy or baseline requires.'),
        question('gs-q2', 2, 'A team reviews user accounts once every quarter. What is this an example of?', ['Continuous monitoring', 'A point-in-time audit', 'A backup', 'Load balancing'], 1, 'A scheduled review at one moment is an audit. Monitoring would be continuous.'),
        question('gs-q3', 3, 'Which finding would an auditor most likely report?', ['The server room is painted blue', 'A former employee still has an active admin account', 'The team prefers one text editor', 'A server was named after a planet'], 1, 'An active admin account for someone who left breaks access policy, so it is a real audit finding.'),
      ],
      flashcards: [
        card('gs-f1', 'System audit', 'A structured review that compares a system against a policy or baseline.'),
        card('gs-f2', 'Baseline', 'The agreed, known-good configuration a system is measured against.'),
        card('gs-f3', 'Finding', 'A gap between what the audit found and what the policy requires.'),
      ],
    }),
    section({
      id: 'fundamentals',
      title: 'Auditing Fundamentals & Key Terms',
      objectives: [
        'Define audit log, audit trail and evidence.',
        'Explain accountability and non-repudiation.',
        'Recognize what makes a log entry useful.',
      ],
      keyPoints: [
        'An audit log records who did what, and when.',
        'An audit trail is the sequence of log entries that reconstructs an event.',
        'Useful entries include a timestamp, a user, an action and a result.',
      ],
      notes: [
        note('fu-n1', 'Audit logs', 'An audit log records information about system activity: who did something, what they did, and when. Administrators use it to investigate events and identify problems.', { keyTerm: 'audit log' }),
        note('fu-n2', 'Accountability', 'Accountability means actions can be traced to a specific user. It depends on unique accounts: if several people share one login, the log cannot say who acted.', { keyTerm: 'unique accounts' }),
      ],
      questions: [
        question('fu-q1', 1, 'Which statement about audit logs is correct?', ['They always prevent attacks', 'They help examine system activity', 'They replace all access controls', 'They are only used on Windows'], 1, 'Logs record activity so it can be examined later. They do not block attacks by themselves.'),
        question('fu-q2', 2, 'Why do shared logins weaken accountability?', ['They make passwords longer', 'The log cannot show which person acted', 'They slow the system down', 'They disable logging'], 1, 'With one shared account, every entry shows the same user, so actions cannot be traced to a person.'),
        question('fu-q3', 3, 'Which log entry is the most useful to an auditor?', ['"Something happened"', '"Error"', '"2026-03-04 10:12 user=mlee action=sudo result=denied"', '"User did a thing yesterday"'], 2, 'It has a timestamp, a user, an action and a result, which are the parts an auditor needs.'),
      ],
      flashcards: [
        card('fu-f1', 'Audit log', 'A record of who did what, and when, on a system.'),
        card('fu-f2', 'Audit trail', 'The sequence of log entries that reconstructs an event.'),
        card('fu-f3', 'Accountability', 'Being able to trace an action to one specific user.'),
      ],
    }),
    section({
      id: 'linux-auditing-commands',
      title: 'Linux System Auditing Commands',
      objectives: [
        'Use key Linux commands for system auditing.',
        'Check logs and identify important system activity.',
        'Apply basic auditing commands in a practical example.',
      ],
      keyPoints: [
        '`who` and `last` show current and past logins.',
        '`ps aux` lists running processes and their owners.',
        '`journalctl` reads the systemd journal; `sudo -l` lists what a user may run with sudo.',
      ],
      notes: [
        note('la-n1', 'Who is on the system?', 'Start an audit by checking logins. `who` shows users logged in right now, and `last` shows the history of recent logins.', { keyTerm: 'last', example: '$ who\n$ last -n 5' }),
        note('la-n2', 'What is running?', '`ps aux` lists every running process with the user that owns it. Look for processes you do not recognize or that run as root without a reason.', { keyTerm: 'ps aux', example: '$ ps aux | head' }),
        note('la-n3', 'Reading the logs', 'On systemd systems, `journalctl` reads the system journal. You can filter by time or by service to focus on the activity you are auditing.', { keyTerm: 'journalctl', example: '$ journalctl -u ssh --since today' }),
      ],
      questions: [
        question('la-q1', 1, 'Which command shows the history of recent logins?', ['ps aux', 'last', 'chmod', 'ping'], 1, '`last` prints recent login sessions. `ps aux` lists processes instead.'),
        question('la-q2', 2, 'You want to see which user owns each running process. Which command fits?', ['ps aux', 'who', 'ls -l', 'df -h'], 0, '`ps aux` lists all processes and includes the owning user in the first column.'),
        question('la-q3', 3, 'You need today\'s SSH service messages only. Which command is best?', ['last -n 5', 'journalctl -u ssh --since today', 'who', 'ps aux | head'], 1, '`-u ssh` filters the journal to the SSH unit and `--since today` limits it to today.'),
        question('la-q4', 2, 'What does `sudo -l` show?', ['The last 10 logins', 'The commands the current user may run with sudo', 'Free disk space', 'Listening network ports'], 1, '`sudo -l` lists the sudo privileges of the current user, which is useful when auditing access.'),
      ],
      flashcards: [
        card('la-f1', 'who', 'Shows the users logged in right now.'),
        card('la-f2', 'last', 'Shows the history of recent logins.'),
        card('la-f3', 'ps aux', 'Lists all running processes with their owners.'),
        card('la-f4', 'journalctl', 'Reads the systemd journal; filter with -u and --since.'),
      ],
    }),
    section({
      id: 'permissions-least-privilege',
      title: 'File Permissions & Least Privilege',
      difficulty: 'Intermediate',
      objectives: [
        'Read Linux permission strings.',
        'Explain the principle of least privilege.',
        'Spot risky permissions in an audit.',
      ],
      keyPoints: [
        'Permissions are shown as read (r), write (w) and execute (x) for owner, group and others.',
        'Least privilege: give each user only the access the job needs.',
        'World-writable files are a common audit finding.',
      ],
      notes: [
        note('pl-n1', 'Reading permissions', '`ls -l` shows a string such as `-rw-r-----`. After the file type, the three groups of letters are the rights of the owner, the group, and everyone else.', { keyTerm: 'owner, the group, and everyone else', example: '$ ls -l report.txt\n-rw-r----- 1 mlee audit 2048 report.txt' }),
        note('pl-n2', 'Least privilege', 'Least privilege means each account gets only the access it needs to do its job. It limits the damage a mistake or a stolen account can cause.', { keyTerm: 'only the access it needs' }),
      ],
      questions: [
        question('pl-q1', 1, 'In `-rw-r-----`, what can the group do?', ['Read and write', 'Read only', 'Execute only', 'Nothing'], 1, 'The middle group of letters is `r--`, so the group can only read.'),
        question('pl-q2', 2, 'Which choice follows least privilege?', ['Give every user admin rights', 'Give a report viewer read-only access', 'Share the root password with the team', 'Make all files world-writable'], 1, 'A viewer only needs to read, so read-only access is the smallest set that works.'),
        question('pl-q3', 3, 'An audit finds `-rwxrwxrwx` on a config file. Why is it a problem?', ['The file is too large', 'Any user can change it', 'It cannot be read', 'It has no owner'], 1, 'The last `rwx` gives every user write access, so anyone could change the configuration.'),
      ],
      flashcards: [
        card('pl-f1', 'r / w / x', 'Read, write and execute permissions.'),
        card('pl-f2', 'Least privilege', 'Give each account only the access its job needs.'),
        card('pl-f3', 'World-writable', 'A file every user on the system can modify.'),
      ],
    }),
    section({
      id: 'network-docker-auditing',
      title: 'Network & Docker Auditing',
      difficulty: 'Intermediate',
      objectives: [
        'List listening ports on a Linux host.',
        'Inspect running Docker containers.',
        'Explain why exposed ports matter in an audit.',
      ],
      keyPoints: [
        '`ss -tuln` lists listening TCP and UDP ports.',
        '`docker ps` lists running containers and their published ports.',
        'Every open port should have a known owner and a reason.',
      ],
      notes: [
        note('nd-n1', 'Listening ports', '`ss -tuln` lists the TCP and UDP ports a host is listening on. In an audit, each open port should map to a service someone can explain.', { keyTerm: 'ss -tuln', example: '$ ss -tuln' }),
        note('nd-n2', 'What is Docker?', 'Docker packages an application and its dependencies into a container, so it runs consistently on any system. `docker ps` shows the running containers.', { keyTerm: 'container', example: '$ docker ps' }),
      ],
      questions: [
        question('nd-q1', 1, 'What is the main purpose of a Docker container?', ['To store large amounts of data', 'To package and run an application with its dependencies', 'To replace the operating system', 'To only run on Linux'], 1, 'A container bundles an application with what it needs so it runs the same way everywhere.'),
        question('nd-q2', 2, 'Which command lists listening ports?', ['docker ps', 'ss -tuln', 'last', 'chmod 600'], 1, '`ss -tuln` shows listening TCP and UDP sockets without resolving names.'),
        question('nd-q3', 3, '`docker ps` shows `0.0.0.0:8080->80/tcp`. What does it mean?', ['The container is stopped', 'Host port 8080 on all interfaces forwards to container port 80', 'Port 80 is blocked', 'The container has no network'], 1, 'The host publishes 8080 on every interface and forwards it to port 80 inside the container.'),
      ],
      flashcards: [
        card('nd-f1', 'ss -tuln', 'Lists listening TCP and UDP ports.'),
        card('nd-f2', 'Container', 'An application packaged with its dependencies.'),
        card('nd-f3', 'docker ps', 'Lists running containers and published ports.'),
      ],
    }),
    section({
      id: 'checkpoint',
      title: 'Module Checkpoint',
      difficulty: 'Intermediate',
      xpReward: 50,
      objectives: ['Review the whole module.', 'Mix commands, permissions and logs.', 'Check that you are ready to move on.'],
      keyPoints: [
        'Audits compare real state against policy.',
        'Logs give accountability when accounts are unique.',
        'Check logins, processes, permissions and ports.',
      ],
      notes: [
        note('cp-n1', 'A simple audit routine', 'A basic host audit checks four things in order: who logged in, what is running, which files are too open, and which ports are listening.', { keyTerm: 'four things', example: '$ last -n 5\n$ ps aux | head\n$ ls -l /etc\n$ ss -tuln' }),
      ],
      questions: [
        question('cp-q1', 1, 'Which command shows who is logged in right now?', ['who', 'last', 'ss -tuln', 'docker ps'], 0, '`who` shows current sessions. `last` shows past ones.'),
        question('cp-q2', 2, 'Which pair matches a command to its audit question?', ['ss -tuln: which ports are listening?', 'who: which files are world-writable?', 'docker ps: who logged in last week?', 'last: which processes are running?'], 0, '`ss -tuln` answers the listening-ports question. The other pairs are mismatched.'),
        question('cp-q3', 3, 'An auditor finds a shared admin login and a world-writable config file. Which principles are broken?', ['Accountability and least privilege', 'Availability and speed', 'Encryption and backup', 'Portability and scaling'], 0, 'A shared login breaks accountability, and world-writable files break least privilege.'),
      ],
      flashcards: [
        card('cp-f1', 'Audit routine', 'Logins, processes, permissions, ports.'),
        card('cp-f2', 'Accountability', 'Needs unique accounts and useful logs.'),
      ],
    }),
  ],
};

const ite379: Course = {
  id: 'ite-379',
  code: 'ITE 379',
  title: 'Cybersecurity',
  unitLabel: 'Ch. 1–4',
  unitTitle: 'Security Foundations',
  pages: 68,
  accent: 'gold',
  provenance: DEMO,
  sections: [
    section({
      id: 'cia-triad',
      title: 'The CIA Triad',
      objectives: ['Name the three parts of the CIA triad.', 'Match a security control to the goal it protects.', 'Classify simple incidents.'],
      keyPoints: [
        'Confidentiality: only authorized people can see the data.',
        'Integrity: data is accurate and has not been changed without permission.',
        'Availability: systems and data are usable when needed.',
      ],
      notes: [
        note('ci-n1', 'Three security goals', 'The CIA triad names three goals of security: confidentiality, integrity and availability. Most controls exist to protect at least one of them.', { keyTerm: 'confidentiality, integrity and availability' }),
        note('ci-n2', 'Matching controls to goals', 'Encryption protects confidentiality. Hashes and checksums protect integrity. Backups and redundancy protect availability.', { keyTerm: 'Encryption' }),
      ],
      questions: [
        question('ci-q1', 1, 'What does the "I" in CIA stand for?', ['Identity', 'Integrity', 'Internet', 'Inspection'], 1, 'The triad is confidentiality, integrity and availability.'),
        question('ci-q2', 2, 'Which control mainly protects confidentiality?', ['Encryption', 'A backup generator', 'A checksum', 'Load balancing'], 0, 'Encryption keeps data unreadable to people who are not authorized.'),
        question('ci-q3', 3, 'A flood of traffic takes a website offline. Which goal is affected?', ['Confidentiality', 'Integrity', 'Availability', 'None of them'], 2, 'The site cannot be used, so availability is affected.'),
      ],
      flashcards: [
        card('ci-f1', 'Confidentiality', 'Only authorized people can see the data.'),
        card('ci-f2', 'Integrity', 'Data is accurate and unchanged without permission.'),
        card('ci-f3', 'Availability', 'Systems and data are usable when needed.'),
      ],
    }),
    section({
      id: 'threats-vulnerabilities',
      title: 'Threats, Vulnerabilities & Risk',
      objectives: ['Define threat, vulnerability and risk.', 'Explain how they relate.', 'Recognize phishing.'],
      keyPoints: [
        'A vulnerability is a weakness.',
        'A threat is something that could exploit a weakness.',
        'Risk combines how likely an event is with how much damage it would do.',
      ],
      notes: [
        note('tv-n1', 'Three related terms', 'A vulnerability is a weakness, such as unpatched software. A threat is something that could exploit it. Risk is the chance of that happening combined with its impact.', { keyTerm: 'Risk' }),
        note('tv-n2', 'Phishing', 'Phishing is a message that pretends to come from a trusted sender to trick someone into giving up credentials or opening malware.', { keyTerm: 'Phishing' }),
      ],
      questions: [
        question('tv-q1', 1, 'Unpatched software is an example of a...', ['Threat', 'Vulnerability', 'Control', 'Policy'], 1, 'It is a weakness in the system, which makes it a vulnerability.'),
        question('tv-q2', 2, 'An email asks you to "verify your password" at an unfamiliar link. What is it most likely?', ['A backup notice', 'Phishing', 'A software patch', 'An audit log'], 1, 'It imitates a trusted sender to collect credentials, which is phishing.'),
        question('tv-q3', 3, 'Which change lowers risk the most for an unpatched public server?', ['Renaming the server', 'Applying the security patch', 'Adding more storage', 'Changing the wallpaper'], 1, 'Patching removes the vulnerability, so the threat has nothing to exploit.'),
      ],
      flashcards: [
        card('tv-f1', 'Vulnerability', 'A weakness that could be exploited.'),
        card('tv-f2', 'Threat', 'Something that could exploit a weakness.'),
        card('tv-f3', 'Risk', 'Likelihood combined with impact.'),
      ],
    }),
    section({
      id: 'authentication',
      title: 'Authentication Basics',
      objectives: ['Tell authentication from authorization.', 'Name the three factor types.', 'Explain why MFA helps.'],
      keyPoints: [
        'Authentication proves who you are; authorization decides what you may do.',
        'Factors: something you know, have, or are.',
        'MFA combines factors from different types.',
      ],
      notes: [
        note('au-n1', 'Authentication vs. authorization', 'Authentication proves who you are. Authorization decides what you are allowed to do once your identity is known.', { keyTerm: 'Authorization' }),
        note('au-n2', 'Multi-factor authentication', 'MFA asks for factors of different types: something you know (a password), something you have (a phone), or something you are (a fingerprint).', { keyTerm: 'different types' }),
      ],
      questions: [
        question('au-q1', 1, 'A password is something you...', ['Have', 'Know', 'Are', 'Share'], 1, 'A password is a knowledge factor.'),
        question('au-q2', 2, 'Which login uses real multi-factor authentication?', ['Password + security question', 'Password + code from a phone app', 'Two different passwords', 'Username + password'], 1, 'A password (know) plus a phone code (have) are two different factor types.'),
        question('au-q3', 3, 'A logged-in student opens the grades admin page and is refused. Which step refused them?', ['Authentication', 'Authorization', 'Encryption', 'Hashing'], 1, 'They were already authenticated. Authorization decided they lack permission.'),
      ],
      flashcards: [
        card('au-f1', 'Authentication', 'Proving who you are.'),
        card('au-f2', 'Authorization', 'Deciding what you may do.'),
        card('au-f3', 'MFA', 'Two or more factors of different types.'),
      ],
    }),
  ],
};

const en339w: Course = {
  id: 'en-339w',
  code: 'EN 339W',
  title: 'Technical Writing',
  unitLabel: 'Unit 1–3',
  unitTitle: 'Writing for Readers',
  pages: 28,
  accent: 'purple',
  provenance: DEMO,
  sections: [
    section({
      id: 'audience-purpose',
      title: 'Audience & Purpose',
      estMinutes: '5–7 min',
      objectives: ['Identify the reader of a document.', 'State a document\'s purpose in one sentence.', 'Adjust detail to the reader.'],
      keyPoints: [
        'Technical writing starts with who will read it and why.',
        'Experts want precision; newcomers need definitions and steps.',
        'A clear purpose statement keeps a document focused.',
      ],
      notes: [
        note('ap-n1', 'Start with the reader', 'Before drafting, decide who will read the document and what they need to do with it. That choice sets the vocabulary, the detail and the length.', { keyTerm: 'who will read the document' }),
        note('ap-n2', 'Purpose statements', 'A purpose statement says in one sentence what the document will help the reader do, for example: "This guide helps new staff reset a password."', { keyTerm: 'one sentence' }),
      ],
      questions: [
        question('ap-q1', 1, 'What should a technical writer decide first?', ['The font', 'The audience and purpose', 'The page count', 'The file name'], 1, 'Audience and purpose shape every later choice.'),
        question('ap-q2', 2, 'You write install steps for first-time users. What should you add?', ['Unexplained acronyms', 'Definitions and numbered steps', 'Longer paragraphs', 'Fewer headings'], 1, 'Newcomers need terms defined and actions broken into steps.'),
        question('ap-q3', 3, 'Which is the strongest purpose statement?', ['"This document is about servers."', '"This guide helps new staff reset a password in five steps."', '"Servers are important."', '"Read this carefully."'], 1, 'It names the reader, the task and the scope in one sentence.'),
      ],
      flashcards: [
        card('ap-f1', 'Audience', 'The people who will read and use the document.'),
        card('ap-f2', 'Purpose statement', 'One sentence saying what the document helps the reader do.'),
      ],
    }),
    section({
      id: 'clear-concise-style',
      title: 'Clear & Concise Style',
      estMinutes: '5–7 min',
      objectives: ['Prefer active voice in instructions.', 'Cut filler words.', 'Write parallel lists.'],
      keyPoints: [
        'Active voice names who does the action.',
        'Short sentences with one idea are easier to follow.',
        'List items should share the same grammatical form.',
      ],
      notes: [
        note('cc-n1', 'Active voice', 'Active voice puts the actor first: "Click Save." Passive voice hides the actor: "Save should be clicked." Instructions are clearer in active voice.', { keyTerm: 'Active voice' }),
        note('cc-n2', 'Cutting filler', 'Replace wordy phrases with one word: "in order to" becomes "to", and "at this point in time" becomes "now".', { keyTerm: 'one word' }),
      ],
      questions: [
        question('cc-q1', 1, 'Which sentence is in active voice?', ['The file was saved by the user.', 'The user saved the file.', 'The file is being saved.', 'Saving was done.'], 1, 'The actor (the user) comes first and performs the action.'),
        question('cc-q2', 2, 'What is the best replacement for "in order to"?', ['"for the purpose of"', '"to"', '"so as to be able to"', '"with the aim of"'], 1, '"To" says the same thing in one word.'),
        question('cc-q3', 3, 'Which list is parallel?', ['Open the app, clicking Save, and then you close it', 'Open the app, click Save, and close the window', 'Opening the app, click Save, closed', 'App opens, Save, closing'], 1, 'Each item starts with a verb in the same form.'),
      ],
      flashcards: [
        card('cc-f1', 'Active voice', 'The actor comes first and does the action.'),
        card('cc-f2', 'Parallel structure', 'List items share the same grammatical form.'),
      ],
    }),
  ],
};

export const DEMO_COURSES: Course[] = [cis344, ite379, en339w];

/**
 * Demo starting progress, so the dashboard is not empty on first launch.
 * Keys are `${courseId}/${sectionId}`.
 */
export const DEMO_COMPLETED_SECTIONS: string[] = [
  'cis-344/getting-started',
  'cis-344/fundamentals',
  'ite-379/cia-triad',
  'en-339w/audience-purpose',
  'en-339w/clear-concise-style',
];

export const DEMO_STARTING_XP = 850;
export const DEMO_STARTING_STREAK = 7;

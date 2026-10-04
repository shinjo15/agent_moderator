const heading = document.createElement('h1');
heading.textContent = 'Agent Moderator';
const notice = document.createElement('p');
notice.textContent = 'フィルター機能は未実装です。';
const settings = document.createElement('a');
settings.textContent = '設定を開く';
settings.href = 'options.html';
document.querySelector('main')!.append(heading, notice, settings);
export {};

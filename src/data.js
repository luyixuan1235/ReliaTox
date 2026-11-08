export const FILE_SIZE = 1024 * 1024 * 1024
export const OFFSET_A = 421 * 1024 * 1024
export const REMAIN_B = FILE_SIZE - OFFSET_A
export const DEMO_HASH = '7a3c91e0b2d64f18c55e90aa1d8e44c0f6b1a29e31c8d7f04e5b6a77c91fe91f'

export const ME = {
  name: '吕奕萱',
  initials: '吕',
  toxId: '7A3C91E0B2D64F18C55E90AA1D8E44C0F6B1A29E31C8D7F04E5B6A77C91FE91F0188',
}

export const COLORS = ['#0f8f82', '#c4473c', '#3d6ea8', '#8a5a12', '#5b4ea8']

export function initialFriends() {
  return [
    { id: 'lin', name: '林晓', initials: '林', color: COLORS[0], presence: '在线', last: '把答辩录像发我', time: '12:24' },
    { id: 'dong', name: '董苟', initials: '董', color: COLORS[1], presence: '在线', last: '续传那边对齐了吗', time: '11:58' },
    { id: 'group', name: '答辩小组', initials: '辩', color: COLORS[2], presence: '3 人在线', last: '周五下午彩排', time: '昨天' },
    { id: 'wang', name: '王老师', initials: '王', color: COLORS[3], presence: '离线', last: '把验证截图放到报告里', time: '周一' },
  ]
}

export function initialMessages() {
  return {
    lin: [
      { id: 1, from: 'lin', type: 'text', text: '录像太大了，按你们说的断点续传走。' },
      { id: 2, from: 'me', type: 'text', text: '好。没有中心服务器，进度记在两边本地。' },
      { id: 3, from: 'me', type: 'file', name: '答辩录像.mp4', size: '1.00 GB', jobId: 'demo' },
      { id: 4, from: 'lin', type: 'text', text: '传到一半我这边 Wi-Fi 会断一下，你看能不能接上。' },
    ],
    dong: [
      { id: 1, from: 'dong', type: 'text', text: '调度别把三个大文件一起打满。' },
      { id: 2, from: 'me', type: 'text', text: '差网会降到 2 路，大文件让路。' },
    ],
    group: [
      { id: 1, from: 'group', type: 'text', text: '周五用 ReliaTox 开会，不走腾讯服务器。' },
      { id: 2, from: 'me', type: 'text', text: '会议入口我建好了，点对点网格。' },
    ],
    wang: [
      { id: 1, from: 'wang', type: 'text', text: '验收看两件事：续传量对不对，哈希一不一致。' },
    ],
  }
}

export function initialJobs() {
  return [
    {
      id: 'demo',
      name: '答辩录像.mp4',
      peer: '林晓',
      direction: '发送',
      size: FILE_SIZE,
      confirmed: OFFSET_A,
      status: 'resume',
      fileId: 'a19e44c0f6b1a29e31c8d7f04e5b6a77c91fe91f7a3c91e0',
      hash: DEMO_HASH,
      sessionSent: 0,
      note: '已确认偏移 421 MB，等待续传',
    },
    {
      id: 'pdf',
      name: '开题报告.pdf',
      peer: '董苟',
      direction: '发送',
      size: 12 * 1024 * 1024,
      confirmed: 8 * 1024 * 1024,
      status: 'run',
      fileId: '11aa22bb33cc44dd55ee66ff77889900aabbccdd',
      hash: '',
      sessionSent: 0,
      note: '传输中',
    },
    {
      id: 'bin',
      name: '数据集-part2.bin',
      peer: '董苟',
      direction: '发送',
      size: 480 * 1024 * 1024,
      confirmed: 120 * 1024 * 1024,
      status: 'run',
      fileId: '90f1e2d3c4b5a6978877665544332211ffeeddcc',
      hash: '',
      sessionSent: 0,
      note: '大文件，调度可能让路',
    },
    {
      id: 'zip',
      name: '参考论文.zip',
      peer: '答辩小组',
      direction: '发送',
      size: 88 * 1024 * 1024,
      confirmed: 0,
      status: 'wait',
      fileId: '0f1e2d3c4b5a697887766554433221100998877',
      hash: '',
      sessionSent: 0,
      note: '等待对方 · 低优先级已暂停',
    },
    {
      id: 'png',
      name: '实验截图.png',
      peer: '王老师',
      direction: '接收',
      size: 2.4 * 1024 * 1024,
      confirmed: 2.4 * 1024 * 1024,
      status: 'done',
      fileId: 'abcdef0123456789abcdef0123456789abcdef01',
      hash: 'c1f0aa19b3e84d27a6c55e90aa1d8e44c0f6b1a29e31c8d7',
      sessionSent: 0,
      note: 'SHA-256 一致，已从临时文件改名',
    },
    {
      id: 'bad',
      name: '损坏样例.dat',
      peer: '林晓',
      direction: '接收',
      size: 18 * 1024 * 1024,
      confirmed: 18 * 1024 * 1024,
      status: 'fail',
      fileId: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      hash: '00000000ffffffffffffffff00000000ffffffff',
      sessionSent: 0,
      note: '校验失败，未改成正式文件名',
    },
  ]
}

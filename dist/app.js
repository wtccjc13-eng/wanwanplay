const animals = [
['01','Formosan Black Bear','land'],['02','Formosan Sika Deer','land'],['03','Formosan Rock Macaque','land'],['04','Blue Magpie','air'],['05','Swinhoe Pheasant','air'],['06','Swinhoe Frogmouth','air'],['07','Taiwan Field Mouse','land'],['08','Taiwanese Serow','land'],['09','Ferret Badger','land'],['10','Taiwanese Pangolin','land'],['11','Mole Shrew','land'],['12','Harlequin Shrimp','water'],['13','Taiwan Barbet','air'],['14','Formosan Landlocked Salmon','water'],['15','Green Sea Turtle','water'],['16','Swinhoe’s Japalura','land'],['17','Formosan Leaf-nosed Bat','air'],['18','Black Face Spoonbill','air'],['19','Collared Scops Owl','air'],['20','Taiwan Hwamei','air'],['21','Crested Serpent Eagle','air'],['22','Hundred-Pacer Snake','land'],['23','Taiwan Beauty Snake','land'],['24','Taipei Tree Frog','land'],['25','Formosan Salamander','land'],['26','Bryde’s Whale','water'],['27','Indo-Pacific Bottlenose Dolphin','water'],['28','Napoleon Wrasse','water'],['29','Eurasian Otter','water'],['30','Giant Flying Squirrel','land'],['31','Formosan Golden Bat','air'],['32','Large Flying Fox','air'],['33','Crab-eating Mongoose','land'],['34','Risso Dolphin','water'],['35','Emerald Tree Skink','land'],['36','Mandarin Fish','water']
].map(([id,name,habitat])=>({id,name,habitat,image:`assets/animal-${id}.webp`}));
const grid=document.querySelector('#animal-grid');
const more=document.querySelector('#show-more');
const dialog=document.querySelector('#animal-dialog');
let filter='all', expanded=false, currentId=null, opener=null;
const habitatNames={land:'On land',air:'With wings',water:'In the water'};
function render(){
 const list=animals.filter(a=>filter==='all'||a.habitat===filter);
 const visible=expanded?list:list.slice(0,8);
 grid.replaceChildren(...visible.map(a=>{
  const card=document.createElement('button');card.className='animal-card';card.setAttribute('aria-label',`Discover ${a.name}`);
  const picture=document.createElement('div');picture.className='animal-image';
  const img=document.createElement('img');img.src=a.image;img.alt=a.name;img.loading='lazy';img.width=720;img.height=1080;
  const number=document.createElement('span');number.className='animal-id';number.textContent=a.id;
  const arrow=document.createElement('span');arrow.className='animal-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
  picture.append(img,number,arrow);const title=document.createElement('h3');title.textContent=a.name;
  const caption=document.createElement('p');caption.textContent=habitatNames[a.habitat]+' · Taiwan collection';
  card.append(picture,title,caption);card.addEventListener('click',()=>openAnimal(a,card));return card;
 }));
 document.querySelector('#collection-count').textContent=`01—${String(visible.length).padStart(2,'0')} / ${list.length}`;
 more.hidden=list.length<=8;
 more.innerHTML=expanded?'Show fewer animals <span>↑</span>':`Meet all ${list.length} animals <span>↓</span>`;
 more.setAttribute('aria-expanded',String(expanded));
}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
 filter=button.dataset.filter;expanded=false;
 document.querySelectorAll('[data-filter]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});render();
}));
more.addEventListener('click',()=>{expanded=!expanded;render();if(!expanded)document.querySelector('#wildlife').scrollIntoView({block:'start'});});
function openAnimal(animal,trigger){
 currentId=animal.id;document.querySelector('#dialog-img').src=animal.image;document.querySelector('#dialog-img').alt=animal.name;document.querySelector('#dialog-title').textContent=animal.name;document.querySelector('#dialog-number').textContent=`${animal.id} / 36`;
 if(!dialog.open){opener=trigger||document.activeElement;dialog.showModal();document.body.classList.add('modal-open');}
}
function draw(){const pool=animals.filter(a=>a.id!==currentId);openAnimal(pool[Math.floor(Math.random()*pool.length)]);}
document.querySelector('#draw-hero').addEventListener('click',draw);document.querySelector('#draw-bottom').addEventListener('click',draw);document.querySelector('#draw-another').addEventListener('click',draw);
dialog.setAttribute('aria-labelledby','dialog-title');document.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');if(opener?.isConnected)opener.focus();});
render();

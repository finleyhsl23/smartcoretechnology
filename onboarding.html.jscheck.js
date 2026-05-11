    const $ = (id) => document.getElementById(id);
    const token = new URLSearchParams(location.search).get("token") || "";
    let invite = null;

    function showOnly(id){["loading","formScreen","done","error"].forEach(x=>$(x).classList.toggle("hide",x!==id));}
    function fail(text){$("errorText").textContent=text;showOnly("error");}
    function showMsg(text){$("msg").textContent=text;$("msg").classList.remove("hide");}

    async function api(path,payload){
      const res=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload||{})});
      const txt=await res.text();
      let data={};
      try{data=JSON.parse(txt)}catch{data={raw:txt}}
      if(!res.ok||data.ok===false)throw new Error(data.error||data.message||data.raw||"Request failed");
      return data;
    }

    async function start(){
      if(!token)return fail("This invite link is missing its onboarding token. Ask for a fresh invite.");
      try{
        const out=await api("/api/lookup-staff-invite",{token});
        invite=out.invite;
        if(!invite)throw new Error("Invite invalid or expired. Ask for a fresh invite.");
        $("inviteInfo").textContent=`Invite for ${invite.full_name || invite.email_to}. This link expires on ${new Date(invite.expires_at).toLocaleString("en-GB")}.`;
        showOnly("formScreen");
      }catch(e){fail(e.message || String(e));}
    }

    async function complete(){
      $("msg").classList.add("hide");
      const password=$("password").value;
      if(password.length<8)return showMsg("Password must be at least 8 characters.");
      if(password!==$("password2").value)return showMsg("Passwords do not match.");
      if(!$("ec1_name").value.trim()||!$("ec1_relationship").value.trim()||!$("ec1_phone").value.trim())return showMsg("Emergency Contact 1 name, relationship and phone are required.");
      const payload={
        token,password,
        title:$("title").value.trim(),pronouns:$("pronouns").value.trim(),gender:$("gender").value.trim(),dob:$("dob").value,nationality:$("nationality").value.trim(),
        house_number_name:$("house_number_name").value.trim(),street_name:$("street_name").value.trim(),town:$("town").value.trim(),postcode:$("postcode").value.trim(),country:$("country").value.trim()||"United Kingdom",
        emergency_contact_1_name:$("ec1_name").value.trim(),emergency_contact_1_relationship:$("ec1_relationship").value.trim(),emergency_contact_1_phone:$("ec1_phone").value.trim(),emergency_contact_1_email:$("ec1_email").value.trim(),
        emergency_contact_2_name:$("ec2_name").value.trim(),emergency_contact_2_relationship:$("ec2_relationship").value.trim(),emergency_contact_2_phone:$("ec2_phone").value.trim(),emergency_contact_2_email:$("ec2_email").value.trim()
      };
      $("submitBtn").disabled=true;
      try{await api("/api/complete-staff-onboarding",payload);showOnly("done");}
      catch(e){showMsg(e.message||String(e));}
      finally{$("submitBtn").disabled=false;}
    }

    $("submitBtn").addEventListener("click",complete);
    start();
  
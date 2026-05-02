/**
 * Jalali Converter - Standalone Browser Version
 * Extracted and adapted from jalali-moment for lightweight browser usage.
 * No dependencies.
 */

(function(){
    var JalaliConverter = {};

    var breaks =  [ -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178 ];

    function div(a, b) { return ~~(a / b); }
    function mod(a, b) { return a - ~~(a / b) * b; }

    function jalCal(jy) {
        var bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0], jm, jump, leap, leapG, march, n, i;
        if (jy < jp || jy >= breaks[bl - 1]) throw new Error("Invalid Jalali year " + jy);
        for (i = 1; i < bl; i += 1) {
            jm = breaks[i];
            jump = jm - jp;
            if (jy < jm) break;
            leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
            jp = jm;
        }
        n = jy - jp;
        leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
        if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
        leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
        march = 20 + leapJ - leapG;
        if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
        leap = mod(mod(n + 1, 33) - 1, 4);
        if (leap === -1) leap = 4;
        return { leap: leap, gy: gy, march: march };
    }

    function g2d(gy, gm, gd) {
        var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
        return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    }

    function d2j(jdn) {
        var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy), jdn1f = g2d(gy, 3, r.march), jd, jm, k;
        k = jdn - jdn1f;
        if (k >= 0) {
            if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; } 
            else { k -= 186; }
        } else {
            jy -= 1; k += 179; if (r.leap === 1) k += 1;
        }
        jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
        return { jy: jy, jm: jm, jd: jd };
    }

    function d2g(jdn) {
        var j, i, gd, gm, gy;
        j = 4 * jdn + 139361631;
        j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
        i = div(mod(j, 1461), 4) * 5 + 308;
        gd = div(mod(i, 153), 5) + 1;
        gm = mod(div(i, 153), 12) + 1;
        gy = div(j, 1461) - 100100 + div(8 - gm, 6);
        return { gy: gy, gm: gm, gd: gd };
    }

    function toJalali(gy, gm, gd) {
        if (Object.prototype.toString.call(gy) === "[object Date]") {
            gd = gy.getDate(); gm = gy.getMonth() + 1; gy = gy.getFullYear();
        }
        return d2j(g2d(gy, gm, gd));
    }

    var jMonths = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

    JalaliConverter.toJalali = toJalali;
    
    // Simple format function. Usage: JalaliConverter.format(unixTimestampInSeconds, 'full' | 'time')
    JalaliConverter.format = function(unixTs, type) {
        var date = new Date(unixTs * 1000);
        var jDate = toJalali(date);
        
        var y = jDate.jy;
        var m = jDate.jm;
        var d = jDate.jd;
        
        var hours = date.getHours();
        var mins = date.getMinutes();
        var minsStr = mins < 10 ? '0' + mins : mins;
        var timeStr = hours + ':' + minsStr;

        if (type === 'time_only') return timeStr;
        if (type === 'date_only') return y + '/' + (m < 10 ? '0'+m : m) + '/' + (d < 10 ? '0'+d : d);
        
        // Default full
        return y + '/' + (m < 10 ? '0'+m : m) + '/' + (d < 10 ? '0'+d : d) + ' ' + timeStr;
    };

    JalaliConverter.getMonthName = function(unixTs) {
        var jDate = toJalali(new Date(unixTs * 1000));
        return jDate.jd + ' ' + jMonths[jDate.jm - 1] + ' ' + jDate.jy;
    };

    window.JalaliConverter = JalaliConverter;
})();

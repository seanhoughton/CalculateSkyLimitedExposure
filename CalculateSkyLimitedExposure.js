#include <pjsr/Sizer.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/NumericControl.jsh>

#feature-id    Utilities > CalculateSkyLimitedExposure

#feature-info  Calculates the sky-limited exposure time for a given camera/telescope combination \
               using a test image containing significant background pixels.

#feature-icon  CalculateSkyLimitedExposure.xpm

#define TITLE CalculateSkyLimitedExposure
#define VERSION 1.0

// Sources:
// Canon camera stats: http://www.astrosurf.com/buil/50d/test.htm
// Astro camera stats: http://starizona.com/acb/ccd/advtheoryexp.aspx


function delquote(str)
{
   return (str=str.replace(/["']{1}/gi,""));
}

function chopPrecision(value, significantDigits)
{
   var dec = Math.pow(10, significantDigits);
   return Math.round(value*dec)/dec;
}

function humanReadableTime(timeInSeconds)
{
   var minutes = Math.floor(timeInSeconds/60.0);
   var seconds = Math.round(timeInSeconds - (minutes*60.0));
   return minutes.toString() + "m " + seconds.toString() + "s";
}

function getKeywordFloatValue(keywords, keyword, defaultValue)
{
   for(var k=0; k < keywords.length; ++k)
   {
      if(keywords[k].name == keyword)
         return parseFloat(keywords[k].value);
   }
   return defaultValue;
}

function CCD(name, gain, readnoise, darkCurrentNoise, bitsPerChannel)
{
	this.name = name;
	this.gain = gain;
	this.readnoise = readnoise;
   this.bitsPerChannel = bitsPerChannel;
   this.darkCurrentNoise = darkCurrentNoise;

   this.getMaxCount = function()
   {
      return Math.pow(2, this.bitsPerChannel)-1;
   }

   this.normToAdu = function(normalizedValue)
   {
      return normalizedValue * this.getMaxCount();
   }

   this.aduToE = function(adu)
   {
      return adu * this.gain;
   }

   this.totalNoiseE = function(t)
   {
      // Ncamera = ( Ndc^2 + Nro^2 )^0.5
      return Math.sqrt(Math.pow(this.darkCurrentNoise,2) * t + Math.pow(this.readnoise,2));
   }
}

function ImageData()
{
   this.pedestal = 0;
   this.exposure = 0;
   this.binning = 1;
   this.image = null;
   this.median = 0;

   this.loadValues = function(view)
   {
      var keywords = view.window.keywords;
      this.pedestal = getKeywordFloatValue(keywords, "PEDESTAL", 0);
      this.exposure = getKeywordFloatValue(keywords, "EXPOSURE", 0);
      this.binning = getKeywordFloatValue(keywords, "XBINNING", 1);
      this.median = this.getMedian();
   }

   this.setView = function(view)
   {
      this.image = view.image;
      this.loadValues(view);
   }

   this.getMedian = function()
   {
      var statistics = new ImageStatistics();
      with(statistics)
      {
         medianEnabled = true;
      }
      statistics.generate(this.image);
      return statistics.median;
   }

   this.getFluxE = function(ccd)
   {
      if(this.image == null)
         return 0;

      var med = this.median;
      return this.convertToE(med, ccd);
   }

   this.convertToE = function(normalizedValue, ccd)
   {
      var adu = ccd.normToAdu(normalizedValue) - this.pedestal;
      return ccd.aduToE(adu);
   }
}

function CalculateOptimalExposureEngine()
{

   this.totalExposure = 3600;
   this.backgroundFluxE = 0;
   this.targetFlux = 0;

   // RO noise model limit model
   //
   this.readoutNoisePct = 5; // in decimal [0,100]
   this.skyLimitedExposure = 0;

   // Quantization limit model
   //
   this.minimumTargetAdu = 15;
   this.ansteyLimitedExposure = 0;


   this.ccd = new CCD('', 0, 0, 0, 0);
   this.backgroundImageData = new ImageData();
   this.targetImageData = new ImageData();

   this.generate = function()
   {
      var backgroundE = this.backgroundImageData.getFluxE(this.ccd);
      this.backgroundFluxE = backgroundE / (this.backgroundImageData.exposure);

      var targetE = this.targetImageData.getFluxE(this.ccd);
      this.targetFlux = targetE / (this.targetImageData.exposure);

      this.skyLimitedExposure = this.calculateSkyLimitedExposure();

      this.ansteyLimitedExposure = this.calculateAnsteyLimitedExposure();
   }

   this.limitedExposureString = function()
   {
      return humanReadableTime(this.skyLimitedExposure) + " (" + Math.round(this.skyLimitedExposure) + "s)";
   }

   this.ansteyLimitedExposureString = function()
   {
      return humanReadableTime(this.ansteyLimitedExposure) + " (" + Math.round(this.ansteyLimitedExposure) + "s)";
   }

   this.fluxString = function(flux)
   {
      var fluxInAdu = chopPrecision(flux * this.ccd.gain, 2);
      var fluxInE = chopPrecision(flux, 2);
      return fluxInE.toString() + " e-/s    (" + fluxInAdu.toString() + " ADU/s)";
   }

   this.backgroundFluxString = function()
   {
      return this.fluxString(this.backgroundFluxE);
   }

   this.targetFluxString = function()
   {
      return this.fluxString(this.targetFlux);
   }

   // from http://starizona.com/acb/ccd/advtheoryexp.aspx
   this.calculateSkyLimitedExposure = function()
   {
      var pct = this.readoutNoisePct / 100.0;
      var effectiveReadoutNoiseE = this.ccd.readnoise / this.backgroundImageData.binning;
      return (effectiveReadoutNoiseE*effectiveReadoutNoiseE) / ((((1.0+pct)*(1.0+pct))-1.0) * this.backgroundFluxE);
   }

   // http://www.cloudynights.com/item.php?item_id=1622
   this.calculateAnsteyLimitedExposure = function()
   {
      // LP noise = LPsignal^0.5
      var lpNoiseE = Math.sqrt(this.backgroundFluxE);
      console.writeln("LP Noise e-/s:    " + lpNoiseE);

      var dcNoiseE = this.ccd.darkCurrentNoise;
      console.writeln("DC Noise e-s:     " + dcNoiseE);

//      var ccdNoiseE = this.ccd.totalNoiseE(1);
//      console.writeln("CCD Noise e-/s:   " + ccdNoiseE);

      var totalNoiseE = Math.sqrt(Math.pow(lpNoiseE,2) + Math.pow(dcNoiseE,2));
      console.writeln("Total Noise e-/s: " + totalNoiseE);

      var minimumTargetE = this.ccd.aduToE(this.minimumTargetAdu);
      console.writeln("Min e-:         " + minimumTargetE);

      var result = minimumTargetE * Math.sqrt(this.totalExposure) / (2 * totalNoiseE);
      console.writeln("Exposure:    " + result);

      return result;
   }
}

var engine = new CalculateOptimalExposureEngine;


var cameraPresets = new Array(
   new CCD('Custom', 0, 0, 0, 16),
   new CCD('Apogee Alta U16M', 1.5, 10, 0, 16),
	new CCD('Apogee AP1E', 3, 15, 0, 16),
	new CCD('Apogee AP2E', 3, 15, 0, 16),
	new CCD('Apogee AP32ME', 3, 10, 0, 16),
	new CCD('Apogee AP260E', 3, 15, 0, 16),
	new CCD('Apogee AP4', 3, 15, 0, 16),
	new CCD('Apogee AP6E', 3, 15, 0, 16),
	new CCD('Apogee AP7', 3, 12, 0, 16),
	new CCD('Apogee AP8', 3, 12, 0, 16),
	new CCD('Apogee AP9E', 3, 15, 0, 16),
	new CCD('Apogee AP10', 3, 15, 0, 16),
	new CCD('Apogee AP16', 3, 15, 0, 16),
	new CCD('Apogee AP47', 3, 7, 0, 16),

   new CCD('Canon 350D @ ISO 400', 2.67, 8.0, 0, 12),
   new CCD('Canon 350D @ ISO 800', 1.33, 8.0, 0, 12),
   new CCD('Canon 400D @ ISO 400', 2.74, 7.0, 0, 12),
   new CCD('Canon 400D @ ISO 800', 1.37, 7.0, 0, 12),
   new CCD('Canon 10D @ ISO 400', 2.41, 14.9, 0, 12),
   new CCD('Canon 10D @ ISO 800', 1.20, 14.9, 0, 12),
   new CCD('Canon 20D @ ISO 400', 3.14, 7.5, 0, 12),
   new CCD('Canon 20D @ ISO 800', 1.57, 7.5, 0, 12),
   new CCD('Canon 40D @ ISO 400', 0.84, 6.8, 0, 14),
   new CCD('Canon 40D @ ISO 800', 0.42, 5.3, 0, 14),
   new CCD('Canon 50D @ ISO 400', 0.57, 4.9, 0, 14),
   new CCD('Canon 50D @ ISO 800', 0.29, 3.4, 0, 14),
   new CCD('Canon 5D @ ISO 400', 3.99, 8.2, 0, 12),
   new CCD('Canon 5D @ ISO 800', 1.99, 5.1, 0, 12),
   new CCD('Canon 5DMkII @ ISO 400', 1.01, 7.3, 0, 14),
   new CCD('Canon 5DMkII @ ISO 800', 0.50, 4.2, 0, 14),

	new CCD('FLI IMG512S', 3, 7, 0, 16),
	new CCD('FLI IMG1024S', 3, 7, 0, 16),
	new CCD('FLI IMG261E', 3, 15, 0, 16),
	new CCD('FLI IMG401E', 1.5, 15, 0, 16),
	new CCD('FLI IMG1001E', 3, 15, 0, 16),
	new CCD('FLI IMG1302E', 3, 15, 0, 16),
	new CCD('FLI IMG1401E', 3, 15, 0, 16),
	new CCD('FLI IMG1602E', 3, 15, 0, 16),
	new CCD('FLI IMG3200E', 3, 10, 0, 16),
	new CCD('FLI IMG4202', 3, 15, 0, 16),
	new CCD('FLI IMG4300E', 3, 15, 0, 16),
	new CCD('FLI IMG6303E', 3, 15, 0, 16),
	new CCD('FLI IMG16801E', 3, 15, 0, 16),
	new CCD('FLI IMG42-40', 2, 7, 0, 16),
	new CCD('FLI MaxCam CM1-1', 3, 7, 0, 16),
	new CCD('FLI MaxCam CM2-2', 2, 7, 0, 16),
	new CCD('FLI MaxCam CM7E', 1.5, 15, 0, 16),
	new CCD('FLI MaxCam CM8E', 1.5, 15, 0, 16),
	new CCD('FLI MaxCam CM9E', 3, 15, 0, 16),
	new CCD('FLI MaxCam CM10E/ME', 3, 10, 0, 16),
   new CCD('FLI M8300', 0.4, 7.59, 0, 16),

	new CCD('QHY8', 3, 10, 0, 16),
	new CCD('QHY8PRO', 3, 10, 0, 16),
	new CCD('QHY9', 0.5, 10, 0, 16),
	new CCD('QSI 504', 2.6, 15, 0, 16),
   new CCD('QSI 516', 2.6, 15, 0, 16),
   new CCD('QSI 532', 1.3, 7, 0, 16),
   new CCD('QSI 520', 0.8, 8, 0, 16),
   new CCD('QSI 540', 0.8, 8, 0, 16),
   new CCD('QSI 583', 0.5, 8, 0, 16),

	new CCD('SBIG ST-237A', 2.3, 17, 0, 16),
	new CCD('SBIG ST-7XE/XME', 2.6, 15, 0, 16),
	new CCD('SBIG ST-8XE/XME', 2.5, 15, 0, 16),
	new CCD('SBIG ST-9XE', 2.2, 15, 0, 16),
	new CCD('SBIG ST-10XE/XME', 1.3, 7, 0, 16),
	new CCD('SBIG ST-2000XM/XCM', 0.6, 7.6, 0, 16),
	new CCD('SBIG ST-4000XCM', 0.6, 7.9, 0, 16),
	new CCD('SBIG ST-1001E', 2, 15, 0, 16),
	new CCD('SBIG STL-4020M/CM', 0.6, 7.8, 0, 16),
	new CCD('SBIG STL-1301E/LE', 1.6, 18, 0, 16),
	new CCD('SBIG STL-1001E', 2, 15, 0, 16),
	new CCD('SBIG STL-11000M/CM', 0.8, 13, 0, 16),
	new CCD('SBIG STL-6303E/LE', 2.4, 13, 0, 16),
	new CCD('SBIG ST-402ME', 2.6, 15, 0, 16),
	new CCD('SBIG ST-8300', 0.37, 9.3, 0, 16),

	new CCD('Starlight Xpress HX516', 1, 11, 0, 16),
	new CCD('Starlight Xpress HX916', 2, 12, 0, 16),
	new CCD('Starlight Xpress MX516', 1, 11, 0, 16),
	new CCD('Starlight Xpress MX716', 1.3, 10, 0, 16),
	new CCD('Starlight Xpress MX916', 2, 11, 0, 16),
	new CCD('Starlight Xpress MX5C', 1, 11, 0, 16),
	new CCD('Starlight Xpress MX7C', 1.3, 10, 0, 16),
	new CCD('Starlight Xpress SXVF-H9/H9C', 0.45, 7, 0, 16),
	new CCD('Starlight Xpress SXVF-M5/M5C', 1, 11, 0, 16),
	new CCD('Starlight Xpress SXVF-M7/M7C', 1.3, 10, 0, 16),
	new CCD('Starlight Xpress SXVF-M8C', 0.2, 7, 0, 16),
	new CCD('Starlight Xpress SXVF-M9', 2, 12, 0, 16),
	new CCD('Starlight Xpress SXVF-M25C', 0.4, 7, 0, 16),
	new CCD('Starlight Xpress SXVF-H35/36', 0.9, 12, 0, 16)
);


function CalculateSkyLimitedExposureDialog()
{
   this.__base__ = Dialog;
   this.__base__();

   var helpLabel = new Label( this );
   with ( helpLabel )
   {
      frameStyle = FrameStyle_Box;
      margin = 4;
      wordWrapping = true;
      useRichText = true;
      text = "<p><b>" + #TITLE + " v" + #VERSION + "</b>" +
             " &mdash; " +
             "This script calculates the exposure at which sky noise overwhelms readout noise in an image. " +
             "The provided test image should be dark subtracted but not flat fielded and contain a significant portion of background sky. " +
             "The suggested exposure will change with each combination of location, camera, telescope, focal reducer, and filter.  For more information " +
             "please read <a href='http://www.hiddenloft.com/notes/SubExposures.pdf'>this paper.</a></p>" +
             "<i>Note: Fields turn red as a warning that it contains an invalid value.</i>";
   }

   // Lengths in pixels of the longest labels, for visual alignment (+ T for security).
   var labelWidth1 = this.font.width( "Noise contribution (%):" + 'T' );
   var labelWidth2 = this.font.width( "Suggested subexposure:" + 'T' );

   // Fixed length in pixels for all numeric edit controls, for visual alignment.
   var editWidth1 = this.font.width( "00000000" );

   /////////////////
   // CAMERA DATA //
   /////////////////

   // Preset list
   //
   this.cameraPresetList = new ComboBox(this);
   with(this.cameraPresetList)
   {
      for(var i=0; i < cameraPresets.length; ++i)
      {
         var camera = cameraPresets[i];
         addItem(camera.name);
      }

      onItemSelected = function( index )
      {
         var camera = cameraPresets[index];
         engine.ccd.readnoise = camera.readnoise;
         engine.ccd.gain = camera.gain;
         engine.ccd.bitsPerChannel = camera.bitsPerChannel;
         engine.ccd.darkCurrentNoise = camera.darkCurrentNoise;
         dialog.refreshUiValues();
      }
   }

   // Max Count
   //
   this.bitsPerChannelValue = new NumericControl(this);
   with(this.bitsPerChannelValue)
   {
      label.text = "ADU Bits:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The number of bits per pixel</p>";
      setRange(0,32);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 ); // ### Note: Do this after setRange() and setPrecision()

      onValueUpdated = function( value )
      {
         engine.ccd.bitsPerChannel = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   // Gain
   //
   this.gainValue = new NumericControl(this);
   with(this.gainValue)
   {
      label.text = "Gain (e-/ADU):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The gain (e-/ADU) for your camera</p>";
      setRange(0,30);
      setPrecision(2);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.ccd.gain = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   // Readout noise
   //
   this.readoutNoiseValue = new NumericControl(this);
   with(this.readoutNoiseValue)
   {
      label.text = "Readout Noise (e-):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The documented readout noise (in e-) for your camera.  Consult the manufacturer for this value.</p>";
      setRange(0,100);
      setPrecision(2);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.ccd.readnoise = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   // Dark noise
   //
   this.darkNoiseValue = new NumericControl(this);
   with(this.darkNoiseValue)
   {
      label.text = "Dark Noise (e-):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The dark noise (in e-) for your camera.  This can be computed by comparing the noise after subtracting one dark frame from another.</p>";
      setRange(0,5);
      setPrecision(3);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.ccd.darkCurrentNoise = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var cameraPropertiesSizer = new VerticalSizer(this);
   with(cameraPropertiesSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.cameraPresetList);
      add(this.bitsPerChannelValue);
      add(this.gainValue);
      add(this.readoutNoiseValue);
      add(this.darkNoiseValue);
   }

   var cameraPropertiesGroup = new GroupBox(this);
   with(cameraPropertiesGroup)
   {
      title = "Camera";
      sizer = cameraPropertiesSizer;
   }


   ///////////////////////////
   // Background Properties //
   ///////////////////////////

   this.backgroundImageList = new ViewList( this );
   with ( this.backgroundImageList )
   {
      getAll();
      toolTip = "<p>Select the image to sample for background level</p>";

      onViewSelected = function( view )
      {
         engine.backgroundImageData.setView(view);
         dialog.refreshUiValues();
      };
   }

   this.backgroundExposureValue = new NumericControl(this);
   with(this.backgroundExposureValue)
   {
      label.text = "Exposure (s):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The exposure in seconds</p>";
      setRange(0,900);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.backgroundImageData.exposure = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.backgroundPedestalValue = new NumericControl(this);
   with(this.backgroundPedestalValue)
   {
      label.text = "Pedestal:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The pedestal added to the values in the image</p>";
      setRange(-300,300);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.backgroundImageData.pedestal = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.backgroundBinningValue = new NumericControl(this);
   with(this.backgroundBinningValue)
   {
      label.text = "Binning:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The binning factor, use a value of '1' for no binning.</p>";
      setRange(1,4);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.backgroundImageData.binning = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var backgroundImagePropertiesSizer = new VerticalSizer(this);
   with(backgroundImagePropertiesSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.backgroundImageList);
      add(this.backgroundExposureValue);
      add(this.backgroundPedestalValue);
      add(this.backgroundBinningValue);
   }

   var backgroundImagePropertiesGroup = new GroupBox(this);
   with(backgroundImagePropertiesGroup)
   {
      title = "Background Image";
      sizer = backgroundImagePropertiesSizer;
   }


   ///////////////////////////
   // Target Properties //
   ///////////////////////////

   this.targetImageList = new ViewList( this );
   with ( this.targetImageList )
   {
      getAll();
      toolTip = "<p>Select the image to sample for target level</p>";

      onViewSelected = function( view )
      {
         engine.targetImageData.setView(view);
         dialog.refreshUiValues();
      };
   }

   this.targetExposureValue = new NumericControl(this);
   with(this.targetExposureValue)
   {
      label.text = "Exposure (s):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The exposure in seconds</p>";
      setRange(0,900);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.targetImageData.exposure = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.targetPedestalValue = new NumericControl(this);
   with(this.targetPedestalValue)
   {
      label.text = "Pedestal:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The pedestal added to the values in the image</p>";
      setRange(-300,300);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.targetImageData.pedestal = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.targetBinningValue = new NumericControl(this);
   with(this.targetBinningValue)
   {
      label.text = "Binning:";
      label.minWidth = labelWidth1;
      toolTip = "<p>The binning factor, use a value of '1' for no binning.</p>";
      setRange(1,4);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.targetImageData.binning = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var targetImagePropertiesSizer = new VerticalSizer(this);
   with(targetImagePropertiesSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.targetImageList);
      add(this.targetExposureValue);
      add(this.targetPedestalValue);
      add(this.targetBinningValue);
   }

   var targetImagePropertiesGroup = new GroupBox(this);
   with(targetImagePropertiesGroup)
   {
      title = "Target Image";
      sizer = targetImagePropertiesSizer;
   }


   /////////////
   // Options //
   /////////////

   // Acceptable noise contribution
   //
   this.readoutNoisePctValue = new NumericControl(this);
   with(this.readoutNoisePctValue)
   {
      label.text = "Read noise (%):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The acceptable amount of readout noise relative to sky noise.  The suggested value is 5%.</p>";
      setRange(0,100);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.readoutNoisePct = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   this.totalExposureValue = new NumericControl(this);
   with(this.totalExposureValue)
   {
      label.text = "Total Exposure (s):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The total exposure time in seconds.  This is the sum of all subexposures times.</p>";
      setRange(0,14400);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.totalExposure = parseFloat(value);
         dialog.refreshUiValues();
      }
   }

   this.minimumTargetAduValue = new NumericControl(this);
   with(this.minimumTargetAduValue)
   {
      label.text = "Minimum Target (ADU):";
      label.minWidth = labelWidth1;
      toolTip = "<p>The minimum ADU value that a target must reach. This should be at least '15'.</p>";
      setRange(0,100);
      setPrecision(0);
      edit.setFixedWidth( editWidth1 );

      onValueUpdated = function( value )
      {
         engine.minimumTargetAdu = parseFloat(value);
         dialog.refreshUiValues();
      }
   }

   var optionSizer = new VerticalSizer(this);
   with(optionSizer)
   {
      spacing = 4;
      margin = 8;
      add(this.readoutNoisePctValue);
      add(this.totalExposureValue);
      add(this.minimumTargetAduValue);
   }

   var optionGroup = new GroupBox( this );
   with ( optionGroup )
   {
      title = "Options";
      sizer = optionSizer;
   }


   /////////////
   // Results //
   /////////////

   // Flux value
   //

   var backgroundFluxLabel = new Label( this );
   with(backgroundFluxLabel)
   {
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Background flux:";
   }

   this.backgroundFluxValue = new Label( this );
   with(this.backgroundFluxValue)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var backgroundFluxSizer = new HorizontalSizer( this );
   with(backgroundFluxSizer)
   {
      spacing = 4;
      add(backgroundFluxLabel);
      add(this.backgroundFluxValue, 100);
   }

   var targetFluxLabel = new Label( this );
   with(targetFluxLabel)
   {
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Target flux:";
   }

   this.targetFluxValue = new Label( this );
   with(this.targetFluxValue)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var targetFluxSizer = new HorizontalSizer( this );
   with(targetFluxSizer)
   {
      spacing = 4;
      add(targetFluxLabel);
      add(this.targetFluxValue, 100);
   }

   // Limit value
   //
   var limitedExposureLabel = new Label( this );
   with(limitedExposureLabel)
   {
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Sky limited exposure:";
   }

   this.limitedExposureValue = new Label( this );
   with(this.limitedExposureValue)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var limitedExposureSizer = new HorizontalSizer( this );
   with(limitedExposureSizer)
   {
      spacing = 4;
      add(limitedExposureLabel);
      add(this.limitedExposureValue, 100);
   }

   // Anstey Model
   //
   var ansteySubexposureLabel = new Label( this );
   with(ansteySubexposureLabel)
   {
      minWidth = labelWidth2;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Anstey subexposure:";
   }

   this.ansteySubexposureValue = new Label( this );
   with(this.ansteySubexposureValue)
   {
      foregroundColor = 0xff0000ff;
      textAlignment = TextAlign_Left|TextAlign_VertCenter;
   }

   var ansteySubexposureSizer = new HorizontalSizer( this );
   with(ansteySubexposureSizer)
   {
      spacing = 4;
      add(ansteySubexposureLabel);
      add(this.ansteySubexposureValue, 100);
   }

   var resultsSizer = new VerticalSizer(this);
   with(resultsSizer)
   {
      spacing = 4;
      margin = 8;
      add(backgroundFluxSizer);
      add(targetFluxSizer);
      add(limitedExposureSizer);
      add(ansteySubexposureSizer);
   }

   var resultsGroup = new GroupBox(this);
   with(resultsGroup)
   {
      title = "Results";
      sizer = resultsSizer;
   }

   // Collect everything
   //
   this.sizer = new VerticalSizer;
   with(this.sizer)
   {
      spacing = 4;
      margin = 8;
      add(helpLabel);
      add(cameraPropertiesGroup);
      add(backgroundImagePropertiesGroup);
      add(targetImagePropertiesGroup);
      add(optionGroup);
      add(resultsGroup);
   }

   this.windowTitle = #TITLE + " Script";
   this.setFixedWidth( 420 );
   this.adjustToContents();
   //this.setFixedSize(); // the dialog does not always open to the right size on small screens

   this.colorizeForErrors = function(control, expression)
   {
      var invalidBackgroundColor = 0xffff0000;
      var validBackgroundColor = 0xffffffff;

      if(expression)
         control.backgroundColor = validBackgroundColor;
      else
         control.backgroundColor = invalidBackgroundColor;

   }

   this.refreshUiValues = function()
   {
      var invalidBackgroundColor = 0xffff0000;
      var validBackgroundColor = 0xffffffff;

      // Background properties
      //
      this.backgroundPedestalValue.setValue(engine.backgroundImageData.pedestal);
      this.backgroundExposureValue.setValue(engine.backgroundImageData.exposure);
      this.colorizeForErrors(this.backgroundExposureValue.edit, engine.backgroundImageData.exposure > 0);
      this.backgroundBinningValue.setValue(engine.backgroundImageData.binning);

      // Target properties
      //
      this.targetPedestalValue.setValue(engine.targetImageData.pedestal);
      this.targetExposureValue.setValue(engine.targetImageData.exposure);
      this.colorizeForErrors(this.targetExposureValue.edit, engine.targetImageData.exposure > 0);
      this.targetBinningValue.setValue(engine.targetImageData.binning);


      // CCD properties
      //
      this.gainValue.setValue(engine.ccd.gain);
      this.colorizeForErrors(this.gainValue.edit, engine.ccd.gain > 0);

      this.bitsPerChannelValue.setValue(engine.ccd.bitsPerChannel);
      this.colorizeForErrors(this.bitsPerChannelValue.edit, engine.ccd.bitsPerChannel > 0);

      this.readoutNoiseValue.setValue(engine.ccd.readnoise);
      this.colorizeForErrors(this.readoutNoiseValue.edit, engine.ccd.readnoise > 0);

      this.darkNoiseValue.setValue(engine.ccd.darkCurrentNoise);
      //this.colorizeForErrors(this.darkNoiseValue.edit, engine.ccd.darkCurrentNoise > 0);

      // Options
      //
      this.readoutNoisePctValue.setValue(engine.readoutNoisePct);
      this.colorizeForErrors(this.readoutNoisePctValue.edit, engine.readoutNoisePct > 0);

      this.colorizeForErrors(this.totalExposureValue.edit, engine.totalExposure > 0);
      this.totalExposureValue.setValue(engine.totalExposure);

      this.colorizeForErrors(this.minimumTargetAduValue.edit, engine.minimumTargetAdu > 0);
      this.minimumTargetAduValue.setValue(engine.minimumTargetAdu);

      engine.generate();
      this.backgroundFluxValue.text = engine.backgroundFluxString();
      this.targetFluxValue.text = engine.targetFluxString();
      this.limitedExposureValue.text = engine.limitedExposureString();
      this.ansteySubexposureValue.text = engine.ansteyLimitedExposureString();
   }

   this.refreshUiValues();
}

CalculateSkyLimitedExposureDialog.prototype = new Dialog;

var dialog = new CalculateSkyLimitedExposureDialog;
//console.hide();
dialog.execute();



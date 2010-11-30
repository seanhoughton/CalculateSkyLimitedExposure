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

function CCD(name, gain, readnoise, bitsPerChannel)
{
	this.name = name;
	this.gain = gain;
	this.readnoise = readnoise;
   this.bitsPerChannel = bitsPerChannel;

   this.getMaxCount = function()
   {
      return Math.pow(2, this.bitsPerChannel)-1;
   }

   this.convertToAdu = function(normalizedValue)
   {
      return normalizedValue * this.getMaxCount();
   }
}

function ImageData()
{
   this.pedestal = 0;
   this.exposure = 0;
   this.binning = 1;
   this.image = null;

   this.loadValues = function(view)
   {
      var keywords = view.window.keywords;
      this.pedestal = getKeywordFloatValue(keywords, "PEDESTAL", 0);
      this.exposure = getKeywordFloatValue(keywords, "EXPOSURE", 0);
      this.binning = getKeywordFloatValue(keywords, "XBINNING", 1);
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

   this.getBackground = function(ccd)
   {
      if(this.image == null)
         return 0;

      var med = this.getMedian();
      var backgroundE = this.convertToE(med, ccd);
      return backgroundE;
   }

   this.convertToE = function(normalizedValue, ccd)
   {
      var intValue = ccd.convertToAdu(normalizedValue) - this.pedestal;
      return intValue * ccd.gain;
   }
}

function CalculateOptimalExposureEngine()
{
   this.readoutNoisePct = 5; // in decimal [0,100]
   this.backgroundFlux = 0;
   this.skyLimitedExposure = 0;
   this.suggestedExposure = "";

   this.ccd = new CCD('', 0, 0, 0);
   this.lightData = new ImageData();

   this.generate = function()
   {
      var backgroundE = this.lightData.getBackground(this.ccd);
      this.backgroundFlux = backgroundE / (this.lightData.exposure)
      this.skyLimitedExposure = this.calculateSkyLimitedExposure(this.backgroundFlux);
   }

   this.suggestedSubexposureString = function()
   {
      var suggestedTime = engine.skyLimitedExposure / 2.0;
      return humanReadableTime(suggestedTime) + " (" + Math.round(suggestedTime) + "s)";
   }

   this.limitedExposureString = function()
   {
      return humanReadableTime(this.skyLimitedExposure) + " (" + Math.round(this.skyLimitedExposure) + "s)";
   }

   // from http://starizona.com/acb/ccd/advtheoryexp.aspx
   this.calculateSkyLimitedExposure = function(backgroundFlux)
   {
      var pct = this.readoutNoisePct / 100.0;
      var effectiveReadoutNoise = this.ccd.readnoise / this.lightData.binning;
      return (effectiveReadoutNoise*effectiveReadoutNoise) / ((((1.0+pct)*(1.0+pct))-1.0) * backgroundFlux);
   }
}

var engine = new CalculateOptimalExposureEngine;


var cameraPresets = new Array(
   new CCD('Custom', 0, 0, 16),
   new CCD('Apogee Alta U16M', 1.5, 10, 16),
	new CCD('Apogee AP1E', 3, 15, 16),
	new CCD('Apogee AP2E', 3, 15, 16),
	new CCD('Apogee AP32ME', 3, 10, 16),
	new CCD('Apogee AP260E', 3, 15, 16),
	new CCD('Apogee AP4', 3, 15, 16),
	new CCD('Apogee AP6E', 3, 15, 16),
	new CCD('Apogee AP7', 3, 12, 16),
	new CCD('Apogee AP8', 3, 12, 16),
	new CCD('Apogee AP9E', 3, 15, 16),
	new CCD('Apogee AP10', 3, 15, 16),
	new CCD('Apogee AP16', 3, 15, 16),
	new CCD('Apogee AP47', 3, 7, 16),

   new CCD('Canon 350D @ ISO 400', 2.67, 8.0, 12),
   new CCD('Canon 350D @ ISO 800', 1.33, 8.0, 12),
   new CCD('Canon 400D @ ISO 400', 2.74, 7.0, 12),
   new CCD('Canon 400D @ ISO 800', 1.37, 7.0, 12),
   new CCD('Canon 10D @ ISO 400', 2.41, 14.9, 12),
   new CCD('Canon 10D @ ISO 800', 1.20, 14.9, 12),
   new CCD('Canon 20D @ ISO 400', 3.14, 7.5, 12),
   new CCD('Canon 20D @ ISO 800', 1.57, 7.5, 12),
   new CCD('Canon 40D @ ISO 400', 0.84, 6.8, 14),
   new CCD('Canon 40D @ ISO 800', 0.42, 5.3, 14),
   new CCD('Canon 50D @ ISO 400', 0.57, 4.9, 14),
   new CCD('Canon 50D @ ISO 800', 0.29, 3.4, 14),
   new CCD('Canon 5D @ ISO 400', 3.99, 8.2, 12),
   new CCD('Canon 5D @ ISO 800', 1.99, 5.1, 12),
   new CCD('Canon 5DMkII @ ISO 400', 1.01, 7.3, 14),
   new CCD('Canon 5DMkII @ ISO 800', 0.50, 4.2, 14),

	new CCD('FLI IMG512S', 3, 7, 16),
	new CCD('FLI IMG1024S', 3, 7, 16),
	new CCD('FLI IMG261E', 3, 15, 16),
	new CCD('FLI IMG401E', 1.5, 15, 16),
	new CCD('FLI IMG1001E', 3, 15, 16),
	new CCD('FLI IMG1302E', 3, 15, 16),
	new CCD('FLI IMG1401E', 3, 15, 16),
	new CCD('FLI IMG1602E', 3, 15, 16),
	new CCD('FLI IMG3200E', 3, 10, 16),
	new CCD('FLI IMG4202', 3, 15, 16),
	new CCD('FLI IMG4300E', 3, 15, 16),
	new CCD('FLI IMG6303E', 3, 15, 16),
	new CCD('FLI IMG16801E', 3, 15, 16),
	new CCD('FLI IMG42-40', 2, 7, 16),
	new CCD('FLI MaxCam CM1-1', 3, 7, 16),
	new CCD('FLI MaxCam CM2-2', 2, 7, 16),
	new CCD('FLI MaxCam CM7E', 1.5, 15, 16),
	new CCD('FLI MaxCam CM8E', 1.5, 15, 16),
	new CCD('FLI MaxCam CM9E', 3, 15, 16),
	new CCD('FLI MaxCam CM10E/ME', 3, 10, 16),
   new CCD('FLI M8300', 0.4, 7.59, 16),

	new CCD('QHY8', 3, 10, 16),
	new CCD('QHY8PRO', 3, 10, 16),
	new CCD('QHY9', 0.5, 10, 16),
	new CCD('QSI 504', 2.6, 15, 16),
   new CCD('QSI 516', 2.6, 15, 16),
   new CCD('QSI 532', 1.3, 7, 16),
   new CCD('QSI 520', 0.8, 8, 16),
   new CCD('QSI 540', 0.8, 8, 16),
   new CCD('QSI 583', 0.5, 8, 16),

	new CCD('SBIG ST-237A', 2.3, 17, 16),
	new CCD('SBIG ST-7XE/XME', 2.6, 15, 16),
	new CCD('SBIG ST-8XE/XME', 2.5, 15, 16),
	new CCD('SBIG ST-9XE', 2.2, 15, 16),
	new CCD('SBIG ST-10XE/XME', 1.3, 7, 16),
	new CCD('SBIG ST-2000XM/XCM', 0.6, 7.6, 16),
	new CCD('SBIG ST-4000XCM', 0.6, 7.9, 16),
	new CCD('SBIG ST-1001E', 2, 15, 16),
	new CCD('SBIG STL-4020M/CM', 0.6, 7.8, 16),
	new CCD('SBIG STL-1301E/LE', 1.6, 18, 16),
	new CCD('SBIG STL-1001E', 2, 15, 16),
	new CCD('SBIG STL-11000M/CM', 0.8, 13, 16),
	new CCD('SBIG STL-6303E/LE', 2.4, 13, 16),
	new CCD('SBIG ST-402ME', 2.6, 15, 16),
	new CCD('SBIG ST-8300', 0.37, 9.3, 16),

	new CCD('Starlight Xpress HX516', 1, 11, 16),
	new CCD('Starlight Xpress HX916', 2, 12, 16),
	new CCD('Starlight Xpress MX516', 1, 11, 16),
	new CCD('Starlight Xpress MX716', 1.3, 10, 16),
	new CCD('Starlight Xpress MX916', 2, 11, 16),
	new CCD('Starlight Xpress MX5C', 1, 11, 16),
	new CCD('Starlight Xpress MX7C', 1.3, 10, 16),
	new CCD('Starlight Xpress SXVF-H9/H9C', 0.45, 7, 16),
	new CCD('Starlight Xpress SXVF-M5/M5C', 1, 11, 16),
	new CCD('Starlight Xpress SXVF-M7/M7C', 1.3, 10, 16),
	new CCD('Starlight Xpress SXVF-M8C', 0.2, 7, 16),
	new CCD('Starlight Xpress SXVF-M9', 2, 12, 16),
	new CCD('Starlight Xpress SXVF-M25C', 0.4, 7, 16),
	new CCD('Starlight Xpress SXVF-H35/36', 0.9, 12, 16)
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


   /////////////////
   // CAMERA DATA //
   /////////////////


   // Preset list
   //
   var cameraPresetList = new ComboBox(this);
   with(cameraPresetList)
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
         dialog.refreshUiValues();
      }
   }

   // Max Count
   //
   var bitsPerChannelLabel = new Label(this);
   with(bitsPerChannelLabel)
   {
      minWidth = 125;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "ADU Bits:";
   }

   this.bitsPerChannelValue = new NumericControl(this);
   with(this.bitsPerChannelValue)
   {
      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
      toolTip = "<p>The number of bits per pixel</p>";
      setRange(0,32);
      setPrecision(0);
      edit.minWidth = 100;

      onValueUpdated = function( value )
      {
         engine.ccd.bitsPerChannel = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var bitsPerChannelSizer = new HorizontalSizer( this );
   with(bitsPerChannelSizer)
   {
      spacing = 4;
      margin = 5;
      add(bitsPerChannelLabel);
      add(this.bitsPerChannelValue);
      addStretch();
   }

   // Gain
   //
   var gainLabel = new Label(this);
   with(gainLabel)
   {
      minWidth = 125;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Gain (e-/ADU):";
   }

   this.gainValue = new NumericControl(this);
   with(this.gainValue)
   {
      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
      toolTip = "<p>The gain (e-/ADU) for your camera</p>";
      setRange(0,30);
      setPrecision(2);
      edit.minWidth = 100;


      onValueUpdated = function( value )
      {
         engine.ccd.gain = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var gainSizer = new HorizontalSizer( this );
   with(gainSizer)
   {
      spacing = 4;
      margin = 5;
      add(gainLabel);
      add(this.gainValue);
      addStretch();
   }

   // Readout noise
   //
   var readoutNoiseLabel = new Label( this );
   with(readoutNoiseLabel)
   {
      minWidth = 125;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Readout Noise (e-):";
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
   }

   this.readoutNoiseValue = new NumericControl(this);
   with(this.readoutNoiseValue)
   {
      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
      toolTip = "<p>The documented readout noise (in e-) for your camera.  Consult the manufacturer for this value.</p>";
      setRange(0,100);
      setPrecision(2);
      edit.minWidth = 100;

      onValueUpdated = function( value )
      {
         engine.ccd.readnoise = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var readoutNoiseSizer = new HorizontalSizer( this );
   with(readoutNoiseSizer)
   {
      spacing = 4;
      margin = 10;
      add(readoutNoiseLabel);
      add(this.readoutNoiseValue);
      addStretch();
   }

   var cameraPropertiesSizer = new VerticalSizer(this);
   with(cameraPropertiesSizer)
   {
      spacing = 4;
      margin = 10;
      add(cameraPresetList);
      add(bitsPerChannelSizer);
      add(gainSizer);
      add(readoutNoiseSizer);
   }

   var cameraPropertiesGroup = new GroupBox(this);
   with(cameraPropertiesGroup)
   {
      title = "Camera";
      sizer = cameraPropertiesSizer;
   }


   //////////////////////
   // Image Properties //
   //////////////////////

   var lightImageList = new ViewList( this );
   with ( lightImageList )
   {
      getAll();
      toolTip = "Select the image to sample for background level";

      onViewSelected = function( view )
      {
         engine.lightData.setView(view);
         dialog.refreshUiValues();
      };
   }

   var lightImageSizer = new HorizontalSizer;
   with(lightImageSizer)
   {
      margin = 4;
      spacing = 10;
      //add(this.lightImageLabel);
      add(lightImageList);
   }

   var exposureLabel = new Label(this);
   with(exposureLabel)
   {
      minWidth = 80;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Exposure (s):";
   }

   this.exposureValue = new NumericControl(this);
   with(this.exposureValue)
   {
      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
      toolTip = "<p>The exposure in seconds</p>";
      setRange(0,900);
      setPrecision(0);
      edit.minWidth = 60;


      onValueUpdated = function( value )
      {
         engine.lightData.exposure = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var exposureSizer = new HorizontalSizer( this );
   with(exposureSizer)
   {
      spacing = 4;
      margin = 5;
      add(exposureLabel);
      add(this.exposureValue);
      addStretch();
   }

   var pedestalLabel = new Label(this);
   with(pedestalLabel)
   {
      minWidth = 80;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Pedestal:";
   }

   this.pedestalValue = new NumericControl(this);
   with(this.pedestalValue)
   {
      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
      toolTip = "<p>The pedestal added to the values in the image</p>";
      setRange(-300,300);
      setPrecision(0);
      edit.minWidth = 60;

      onValueUpdated = function( value )
      {
         engine.lightData.pedestal = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var pedestalSizer = new HorizontalSizer( this );
   with(pedestalSizer)
   {
      spacing = 4;
      margin = 5;
      add(pedestalLabel);
      add(this.pedestalValue);
      addStretch();
   }

   var binningLabel = new Label(this);
   with(binningLabel)
   {
      minWidth = 80;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Binning:";
   }

   this.binningValue = new NumericControl(this);
   with(this.binningValue)
   {
      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;
      toolTip = "<p>The binning factor, use a value of '1' for no binning.</p>";
      setRange(1,4);
      setPrecision(0);
      edit.minWidth = 60;

      onValueUpdated = function( value )
      {
         engine.lightData.binning = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var binningSizer = new HorizontalSizer( this );
   with(binningSizer)
   {
      spacing = 4;
      margin = 5;
      add(binningLabel);
      add(this.binningValue);
      addStretch();
   }

   var imagePropertiesSizer = new VerticalSizer(this);
   with(imagePropertiesSizer)
   {
      spacing = 4;
      margin = 5;
      add(lightImageSizer);
      add(exposureSizer);
      add(pedestalSizer);
      add(binningSizer);
   }

   var imagePropertiesGroup = new GroupBox(this);
   with(imagePropertiesGroup)
   {
      title = "Test Image";
      sizer = imagePropertiesSizer;
   }


   /////////////
   // Options //
   /////////////

   // Acceptable noise contribution
   //
   var readoutNoisePctLabel = new Label( this );
   with(readoutNoisePctLabel)
   {
      minWidth = 100;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Noise contribution (%)";
   }

   this.readoutNoisePctValue = new NumericControl(this);
   with(this.readoutNoisePctValue)
   {
      toolTip = "<p>The acceptable constribution of readout noise.  The suggested value is 5%.</p>";
      setRange(0,100);
      setPrecision(0);

      label.textAlignment = TextAlign_Right|TextAlign_VertCenter;

      onValueUpdated = function( value )
      {
         engine.readoutNoisePct = parseFloat(value);
         dialog.refreshUiValues();
      };
   }

   var readoutNoisePctSizer = new HorizontalSizer( this );
   with(readoutNoisePctSizer)
   {
      spacing = 4;
      margin = 10;
      add(readoutNoisePctLabel);
      add(this.readoutNoisePctValue);
      addStretch();
   }

   var optionSizer = new VerticalSizer(this);
   with(optionSizer)
   {
      spacing = 4;
      margin = 10;
      add(readoutNoisePctSizer);
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
      minWidth = 140;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Background flux:";
   }

   this.backgroundFluxValue = new Label( this );
   with(this.backgroundFluxValue)
   {
      foregroundColor = 0xff0000ff;
   }

   var backgroundFluxSizer = new HorizontalSizer( this );
   with(backgroundFluxSizer)
   {
      spacing = 4;
      margin = 10;
      add(backgroundFluxLabel);
      add(this.backgroundFluxValue);
      addStretch();
   }

   // Limit value
   //
   var limitedExposureLabel = new Label( this );
   with(limitedExposureLabel)
   {
      minWidth = 140;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Sky limited exposure:";
   }

   this.limitedExposureValue = new Label( this );
   with(this.limitedExposureValue)
   {
      foregroundColor = 0xff0000ff;
   }

   var limitedExposureSizer = new HorizontalSizer( this );
   with(limitedExposureSizer)
   {
      spacing = 4;
      margin = 10;
      add(limitedExposureLabel);
      add(this.limitedExposureValue);
      addStretch();
   }


   // Exposure value
   //
   var suggestedSubexposureLabel = new Label( this );
   with(suggestedSubexposureLabel)
   {
      minWidth = 140;
      textAlignment = TextAlign_Right|TextAlign_VertCenter;
      text = "Suggested subexposure:";
   }

   this.suggestedSubexposureValue = new Label( this );
   with(this.suggestedSubexposureValue)
   {
      foregroundColor = 0xff0000ff;
   }

   var suggestedSubexposureSizer = new HorizontalSizer( this );
   with(suggestedSubexposureSizer)
   {
      spacing = 4;
      margin = 10;
      add(suggestedSubexposureLabel);
      add(this.suggestedSubexposureValue);
      addStretch();
   }

   var resultsSizer = new VerticalSizer(this);
   with(resultsSizer)
   {
      spacing = 4;
      margin = 10;
      add(backgroundFluxSizer);
      add(limitedExposureSizer);
      add(suggestedSubexposureSizer);
   }

   var resultsGroup = new GroupBox(this);
   with(resultsGroup)
   {
      title = "Results";
      sizer = resultsSizer;
   }


   // Calculate button
   //
   var findExposureButton = new PushButton( this );
   with ( findExposureButton )
   {
      text = "Calculate";
      onClick = function()
      {
         if(this.busy)
            return;

         this.busy = true;
         engine.generate();
         parent.backgroundFluxValue.text = (Math.round(engine.backgroundFlux*10)/10).toString() + " e-/s";
         parent.limitedExposureValue.text = engine.limitedExposureString();
         parent.suggestedSubexposureValue.text = engine.suggestedSubexposureString();
         this.busy = false;
      }
   }

   // Collect everything
   //
   this.sizer = new VerticalSizer;
   with(this.sizer)
   {
      margin = 10;
      spacing = 4;
      add(helpLabel);
      add(cameraPropertiesGroup);
      add(imagePropertiesGroup);
      add(optionGroup);
      add(resultsGroup);
      add(findExposureButton);
   }

   this.windowTitle = #TITLE + " Script";
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

      this.pedestalValue.setValue(engine.lightData.pedestal);

      this.exposureValue.setValue(engine.lightData.exposure);
      this.colorizeForErrors(this.exposureValue.edit, engine.lightData.exposure > 0);

      this.binningValue.setValue(engine.lightData.binning);

      this.gainValue.setValue(engine.ccd.gain);
      this.colorizeForErrors(this.gainValue.edit, engine.ccd.gain > 0);

      this.bitsPerChannelValue.setValue(engine.ccd.bitsPerChannel);
      this.colorizeForErrors(this.bitsPerChannelValue.edit, engine.ccd.bitsPerChannel > 0);

      this.readoutNoiseValue.setValue(engine.ccd.readnoise);
      this.colorizeForErrors(this.readoutNoiseValue.edit, engine.ccd.readnoise > 0);

      this.readoutNoisePctValue.setValue(engine.readoutNoisePct);
   }

   this.refreshUiValues();
}

CalculateSkyLimitedExposureDialog.prototype = new Dialog;

var dialog = new CalculateSkyLimitedExposureDialog;
console.hide();
dialog.execute();


